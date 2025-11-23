import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    signInAnonymously, 
    signInWithCustomToken, 
    onAuthStateChanged 
} from 'firebase/auth';
import { 
    getFirestore, 
    doc, 
    getDoc, 
    collection, 
    query, 
    getDocs, 
    limit, 
    orderBy,
    setDoc,
    serverTimestamp,
    onSnapshot,
    setLogLevel
} from 'firebase/firestore';

// Set Firebase log level for debugging
setLogLevel('Debug');

// Global variables provided by the environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Initialize Firebase services outside the component for memoization
const app = Object.keys(firebaseConfig).length ? initializeApp(firebaseConfig) : null;
const db = app ? getFirestore(app) : null;
const auth = app ? getAuth(app) : null;

// --- FIRESTORE PATHS ---
// Admin List lives in a public settings document (must be manually created in Firestore console)
const ADMINS_DOC_PATH = `artifacts/${appId}/public/settings/admins`; 
// Public collection for all users to log activity (Admin can view all)
const ACTIVITIES_COLLECTION_PATH = `artifacts/${appId}/public/data/app_activities`;

// Example initial state for activity logging (simulates a user creating data)
const initialActivity = {
    content: "Initial activity logged to public feed.",
    timestamp: serverTimestamp(),
    userId: "SYSTEM"
};


// Main Application Component
const App = () => {
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);
    const [globalActivities, setGlobalActivities] = useState([]);
    const [logMessage, setLogMessage] = useState('');

    // 1. AUTHENTICATION & INITIALIZATION
    useEffect(() => {
        if (!auth) {
            console.error("Firebase Auth not initialized. Check __firebase_config.");
            setLoading(false);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setUserId(user.uid);
                await checkAdminStatus(user.uid);
            } else {
                // If user is not signed in, try anonymous sign-in or use custom token
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(auth, initialAuthToken);
                    } else {
                        await signInAnonymously(auth);
                    }
                    // onAuthStateChanged will be triggered again with the new user
                } catch (error) {
                    console.error("Authentication failed:", error);
                    setUserId('anonymous');
                }
            }
            setIsAuthReady(true);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []); // Run only once on mount

    // 2. ADMIN STATUS CHECK
    const checkAdminStatus = useCallback(async (currentUserId) => {
        if (!db || !currentUserId) return;

        try {
            const docRef = doc(db, ADMINS_DOC_PATH);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                // Assumes the admins document contains an array or map of admin IDs
                const adminList = data.uids || [];
                const isUserAdmin = adminList.includes(currentUserId);
                setIsAdmin(isUserAdmin);
                console.log(`User ${currentUserId} is admin: ${isUserAdmin}`);
            } else {
                console.log("Admins document does not exist. No one is admin.");
                setIsAdmin(false);
            }
        } catch (error) {
            console.error("Error checking admin status:", error);
            setIsAdmin(false);
        }
    }, [db]);

    // 3. REAL-TIME PUBLIC ACTIVITY LISTENER (Accessible by everyone, but mainly useful for Admin)
    useEffect(() => {
        if (!db || !isAuthReady) return;

        // Log a system message if the activity collection is empty on first load
        const logInitialActivity = async () => {
             try {
                const q = query(collection(db, ACTIVITIES_COLLECTION_PATH), limit(1));
                const snapshot = await getDocs(q);
                if (snapshot.empty) {
                    await setDoc(doc(db, ACTIVITIES_COLLECTION_PATH, 'system-init'), initialActivity);
                    console.log("Logged initial system activity.");
                }
            } catch (error) {
                console.error("Error logging initial activity:", error);
            }
        };
        
        logInitialActivity(); // Ensure there is always some data

        // Set up real-time listener for activities (ordered by timestamp)
        const q = query(collection(db, ACTIVITIES_COLLECTION_PATH), orderBy('timestamp', 'desc'), limit(100));
        
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const activities = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data(),
                timestamp: d.data().timestamp?.toDate()?.toLocaleTimeString() || 'N/A'
            }));
            setGlobalActivities(activities);
        }, (error) => {
            console.error("Error fetching global activities:", error);
        });

        return () => unsubscribe();
    }, [db, isAuthReady]);

    // Function to simulate user interaction by logging an activity
    const logUserActivity = async () => {
        if (!db || !userId || !logMessage.trim()) return;
        setLogMessage('Logging...');
        try {
            const activityRef = doc(collection(db, ACTIVITIES_COLLECTION_PATH));
            await setDoc(activityRef, {
                content: logMessage.trim(),
                timestamp: serverTimestamp(),
                userId: userId,
                // Additional data for admin to inspect:
                is_admin: isAdmin, 
                app_version: '1.0'
            });
            setLogMessage('');
        } catch (error) {
            console.error("Error logging user activity:", error);
            setLogMessage('Error logging activity.');
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-900">
                <div className="text-xl font-semibold text-white">Connecting to Firebase...</div>
            </div>
        );
    }

    // --- SUB-COMPONENTS ---

    const UserDashboard = () => (
        <div className="p-6 bg-white shadow-xl rounded-xl">
            <h2 className="text-3xl font-bold text-gray-800 mb-4">User Activity Log</h2>
            <p className="mb-4 text-gray-600">Log a message to the public feed. The admin can see this.</p>
            <div className="flex space-x-3">
                <input
                    type="text"
                    placeholder="Enter activity message..."
                    value={logMessage}
                    onChange={(e) => setLogMessage(e.target.value)}
                    className="flex-grow p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                />
                <button
                    onClick={logUserActivity}
                    disabled={!logMessage.trim() || logMessage === 'Logging...'}
                    className="px-6 py-3 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:bg-indigo-400 transition duration-150 ease-in-out font-medium shadow-md"
                >
                    Log Activity
                </button>
            </div>
        </div>
    );
    
    const AdminDashboard = () => (
        <div className="p-8 bg-gray-100 shadow-2xl rounded-2xl w-full">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-4xl font-extrabold text-red-700 border-b-4 border-red-500 pb-2">
                    <span role="img" aria-label="shield">🛡️</span> Admin Panel
                </h2>
                <span className="bg-red-500 text-white text-sm font-semibold px-4 py-1 rounded-full shadow-lg">ADMIN MODE</span>
            </div>
            
            <p className="text-lg text-gray-700 mb-6">
                Viewing all 
                <span className="font-mono text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-md mx-1">
                    {ACTIVITIES_COLLECTION_PATH.split('/').slice(-1)[0]}
                </span>
                activities.
            </p>

            <div className="space-y-4">
                {globalActivities.length === 0 ? (
                    <div className="text-center p-10 bg-white rounded-lg border-2 border-dashed border-gray-300">
                        No activities found.
                    </div>
                ) : (
                    <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                        {globalActivities.map((activity, index) => (
                            <div key={index} className="flex flex-col bg-white p-4 rounded-lg shadow-sm border-l-4 border-red-400 transition hover:shadow-md">
                                <div className="flex justify-between items-start">
                                    <p className="font-semibold text-gray-800 flex-grow pr-4">
                                        {activity.content}
                                    </p>
                                    <span className={`text-xs font-mono px-3 py-1 rounded-full ${activity.is_admin ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                                        {activity.is_admin ? 'ADMIN' : 'USER'}
                                    </span>
                                </div>
                                <div className="mt-2 text-sm text-gray-500">
                                    <span className="font-mono bg-gray-200 text-gray-700 px-1 rounded-sm text-xs">
                                        User ID: {activity.userId.substring(0, 10)}...
                                    </span>
                                    <span className="ml-4">
                                        Logged at: {activity.timestamp}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <p className="mt-6 text-sm text-gray-500 italic">
                Note: In a real environment, you would use this dashboard to perform CRUD operations on users or data.
            </p>
        </div>
    );

    // --- MAIN RENDER ---
    return (
        <div className="min-h-screen bg-gray-900 p-8 flex flex-col items-center justify-center font-sans">
            <div className="max-w-4xl w-full space-y-8">
                <header className="text-center text-white pb-4 border-b border-gray-700">
                    <h1 className="text-4xl font-extrabold tracking-tight">Real-Time App Manager</h1>
                    <p className="text-indigo-400 mt-1">Role-Based Access Control Example</p>
                </header>

                <div className="bg-gray-800 p-4 rounded-xl shadow-lg text-white font-mono text-sm">
                    <p className="mb-2">User ID: <span className="text-yellow-400 break-all">{userId || 'N/A'}</span></p>
                    <p>Role: <span className={`font-bold ${isAdmin ? 'text-red-500' : 'text-green-500'}`}>{isAdmin ? 'Administrator' : 'Standard User'}</span></p>
                </div>
                
                {isAdmin ? <AdminDashboard /> : <UserDashboard />}
            </div>
        </div>
    );
};

export default App;