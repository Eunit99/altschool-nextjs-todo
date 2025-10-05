"use client"

import React, { useState, useEffect, useMemo, useCallback } from 'react';
// Import initialized services from the new config file
import { db as firestoreDb, auth as firebaseAuth } from '../../firebase/config';
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, query, serverTimestamp,
  Firestore, Timestamp, FieldValue
} from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';






// --- TypeScript Interfaces ---
type Category = 'business' | 'personal';

// Define the structure of a Todo item as stored in the component state
interface Todo {
  id: string;
  content: string;
  category: Category;
  done: boolean;
  // Firestore's serverTimestamp returns a FieldValue on creation, but a Timestamp on read.
  createdAt: Timestamp | FieldValue | { seconds: number; nanoseconds: number } | null | undefined;
  createdBy: string | null;
}





function AppPage() {

  // --- State Variables ---
  const [name, setName] = useState<string>('');
  const [todos, setTodos] = useState<Todo[]>([]);
  const [inputContent, setInputContent] = useState<string>('');
  // Initialize category to a default value for better UX
  const [inputCategory, setInputCategory] = useState<Category>('personal');

  // Firebase state is now handled internally via imported singletons, but we still track userId and syncStatus
  const [userId, setUserId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>('Initializing...');

  // Hardcode a static ID for the public collection path in a non-Canvas environment
  const appId = 'nextjs-todo-app';

  // --- Firebase Authentication and Listener Setup ---

  useEffect(() => {
    // 1. Set up Auth Listener
    if (!firebaseAuth) {
      setSyncStatus('Error: Firebase Auth not configured.');
      return;
    }

    const signIn = async () => {
      try {
        // In a standard Next.js app, we usually sign in anonymously initially
        await signInAnonymously(firebaseAuth);
      } catch (error) {
        console.error("Firebase Auth Error:", error);
        setSyncStatus('Auth Error. Check console.');
      }
    };

    const unsubscribeAuth = onAuthStateChanged(firebaseAuth, (user) => {
      if (user) {
        setUserId(user.uid);
        setSyncStatus('Authenticated. Ready for sync.');
      } else {
        signIn(); // Attempt to sign in if no user is found
      }
    });

    // 2. Load local name state
    const storedName = localStorage.getItem('name');
    if (storedName) {
      setName(storedName);
    }

    return () => unsubscribeAuth();
  }, []); // Run only once on component mount

  // --- Firestore Data Path Utility ---
  // Using useCallback and checking for firestoreDb ensures stability
  const getTodosCollectionRef = useCallback(() => {
    if (!firestoreDb) return null;
    // Use public path for a collaborative Todo list
    return collection(firestoreDb, 'artifacts', appId, 'public', 'data', 'todos');
  }, [firestoreDb, appId]);


  // --- Real-time Firestore Data Listener (Offline Sync) ---
  useEffect(() => {
    if (!firestoreDb || !userId) return;

    const todosColRef = getTodosCollectionRef();
    if (!todosColRef) return;

    const q = query(todosColRef);

    // Listen for changes
    const unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
      const todosData: Todo[] = snapshot.docs.map(doc => ({
        id: doc.id,
        // Ensure data is cast correctly for TypeScript
        ...doc.data() as Omit<Todo, 'id'>,
      }));

      setTodos(todosData);
      setSyncStatus('Synced (' + new Date().toLocaleTimeString() + ')');
    }, (error) => {
      console.error("Firestore onSnapshot Error:", error);
      setSyncStatus('Sync Error. Check console.');
    });

    return () => unsubscribeSnapshot();
  }, [firestoreDb, userId, getTodosCollectionRef]);


  // --- Local Storage Watcher for Name (Non-synced data) ---
  useEffect(() => {
    if (name) {
      localStorage.setItem('name', name);
    }
  }, [name]);

  // --- Core CRUD Functions (Typed) ---

  const addTodo = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!inputContent.trim() || !inputCategory || !firestoreDb) {
      return;
    }

    const todosColRef = getTodosCollectionRef();
    if (!todosColRef) return;

    const newDocRef = doc(todosColRef);

    try {
      await setDoc(newDocRef, {
        content: inputContent.trim(),
        category: inputCategory,
        done: false,
        createdAt: serverTimestamp(),
        createdBy: userId,
      });

      setInputContent('');
      // setInputCategory('personal'); // Optional: reset category
    } catch (error) {
      console.error("Error adding todo:", error);
      setSyncStatus('Failed to add todo. Check console.');
    }
  };

  const removeTodo = async (todoId: string) => {
    if (!firestoreDb) return;
    const todosColRef = getTodosCollectionRef();
    if (!todosColRef) return;

    try {
      await deleteDoc(doc(todosColRef, todoId));
    } catch (error) {
      console.error("Error deleting todo:", error);
      setSyncStatus('Failed to delete todo. Check console.');
    }
  };

  const toggleDone = async (todo: Todo) => {
    if (!firestoreDb) return;
    const todosColRef = getTodosCollectionRef();
    if (!todosColRef) return;

    const todoRef = doc(todosColRef, todo.id);
    try {
      // Only update the 'done' field
      await setDoc(todoRef, { done: !todo.done }, { merge: true });
    } catch (error) {
      console.error("Error updating todo done status:", error);
      setSyncStatus('Failed to update todo status. Check console.');
    }
  };

  const updateContent = async (todoId: string, newContent: string) => {
    if (!firestoreDb || !newContent.trim()) return;
    const todosColRef = getTodosCollectionRef();
    if (!todosColRef) return;

    const todoRef = doc(todosColRef, todoId);
    try {
      await setDoc(todoRef, { content: newContent.trim() }, { merge: true });
    } catch (error) {
      console.error("Error updating todo content:", error);
      setSyncStatus('Failed to update todo content. Check console.');
    }
  }


  // --- Derived State (Sorting) ---
  const todosAsc = useMemo(() => {
    // Sort locally by createdAt timestamp's seconds property, handling null/undefined
    return [...todos].sort((a, b) => {
      const timeA = (a.createdAt as Timestamp)?.seconds || 0;
      const timeB = (b.createdAt as Timestamp)?.seconds || 0;
      return timeA - timeB;
    });
  }, [todos]);


  return (
    <>  <main className="max-w-xl mx-auto p-4 md:p-6 rounded-xl bg-light-color shadow-2xl">
      {/* Header Section */}
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold mb-4 text-dark-color">
          Welcome, <input
            type="text"
            placeholder="Name here"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-transparent border-b-2 border-primary-color px-2 py-1 text-primary-color focus:outline-none"
          />
        </h1>
        <div className="text-sm font-medium text-gray-500 flex justify-between items-center">
          <span>
            User ID: <span className="text-xs text-primary-color font-mono">{userId || 'Loading...'}</span>
          </span>
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold ${syncStatus.includes('Synced') ? 'bg-green-100 text-green-700' :
              syncStatus.includes('Error') ? 'bg-red-100 text-red-700' :
                'bg-yellow-100 text-yellow-700'
              }`}
            title="This status reflects the connection to the real-time Firestore database which provides the offline sync capability."
          >
            {syncStatus}
          </span>
        </div>
      </header>

      {/* Todo Creation Section */}
      <section className="mb-8 p-6 bg-white rounded-xl shadow-custom">
        <h3 className="text-xl font-bold mb-4 text-dark-color">CREATE A TODO</h3>

        <form onSubmit={addTodo}>
          <h4 className="text-md font-semibold mb-2 text-dark-color">What&apos;s on your todo list?</h4>
          <input
            type="text"
            placeholder="e.g. make a video"
            value={inputContent}
            onChange={(e) => setInputContent(e.target.value)}
            className="w-full p-3 mb-4 rounded-lg border-2 border-gray-300 focus:border-primary-color focus:ring-primary-color text-lg"
          />

          <h4 className="text-md font-semibold mb-2 text-dark-color">Pick a category</h4>
          <div className="flex space-x-4 mb-6">
            {/* Business Option */}
            <label className={`flex-1 p-3 rounded-xl border-2 cursor-pointer transition-all ${inputCategory === 'business' ? 'border-business-color' : 'border-gray-300'}`}>
              <input
                type="radio"
                name="category"
                value="business"
                checked={inputCategory === 'business'}
                onChange={() => setInputCategory('business')}
                className="hidden"
              />
              <div className="flex items-center space-x-2">
                <span className="bubble bubble-business"></span>
                <div className="font-medium text-dark-color">Business</div>
              </div>
            </label>

            {/* Personal Option */}
            <label className={`flex-1 p-3 rounded-xl border-2 cursor-pointer transition-all ${inputCategory === 'personal' ? 'border-personal-color' : 'border-gray-300'}`}>
              <input
                type="radio"
                name="category"
                value="personal"
                checked={inputCategory === 'personal'}
                onChange={() => setInputCategory('personal')}
                className="hidden"
              />
              <div className="flex items-center space-x-2">
                <span className="bubble bubble-personal"></span>
                <div className="font-medium text-dark-color">Personal</div>
              </div>
            </label>
          </div>

          <button
            type="submit"
            className="cursor-pointer w-full py-3 rounded-lg text-lg font-bold text-dark transition-all transform hover:scale-[1.01] hover:shadow-lg bg-primary border-2 border-primary shadow-md"
          >
            Add Todo
          </button>
        </form>
      </section>

      {/* Todo List Section */}
      <section className="todo-list">
        <h3 className="text-xl font-bold mb-4 text-dark-color">TODO LIST</h3>
        <div className="list">
          {todosAsc.length === 0 ? (
            <p className="text-gray-500 text-center py-4">Your todo list is empty. Add a task above!</p>
          ) : (
            todosAsc.map((todo) => {
              const bubbleClass = todo.category === 'business' ? 'bubble-business' : 'bubble-personal';
              return (
                <div
                  key={todo.id}
                  className={`todo-item flex items-center bg-white border border-gray-200 p-4 rounded-xl shadow-custom mb-3 transition-opacity ${todo.done ? 'opacity-60 done' : 'opacity-100'}`}
                >
                  {/* Checkbox/Bubble */}
                  <label className="mr-4 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={todo.done}
                      onChange={() => toggleDone(todo)}
                      className="hidden"
                    />
                    <span className={`bubble ${bubbleClass} border-dark-color`}></span>
                  </label>

                  {/* Todo Content (Editable Input) */}
                  <div className="flex-1">
                    <input
                      type="text"
                      value={todo.content}
                      onChange={(e) => {
                        // Update local state temporarily for smooth typing
                        setTodos(prevTodos => prevTodos.map(t =>
                          t.id === todo.id ? { ...t, content: e.target.value } : t
                        ));
                      }}
                      onBlur={(e) => updateContent(todo.id, e.target.value)}
                      className="w-full text-lg text-dark-color focus:outline-none bg-transparent border-b border-transparent focus:border-gray-300 p-1 -m-1"
                    />
                  </div>

                  {/* Actions */}
                  <div className="ml-4">
                    <button
                      className="py-2 px-4 rounded-lg text-white font-medium bg-danger-color hover:bg-red-500 transition-colors transform hover:scale-[1.05] cursor-pointer"
                      onClick={() => removeTodo(todo.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <footer className="mt-8 pt-4 border-t border-gray-200 text-center text-sm text-gray-400">
        <p>Data is stored in Firestore and synced across all instances of this application (App ID: <span className="font-mono">{appId}</span>).</p>
      </footer>
    </main>
    </>
  )
}

export default AppPage