import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyA7XXZaXGrs6g4La5lkd3Vil8AJSUXTlek",
  authDomain: "sogo-e5ea9.firebaseapp.com",
  projectId: "sogo-e5ea9",
  storageBucket: "sogo-e5ea9.firebasestorage.app",
  messagingSenderId: "1035132864845",
  appId: "1:1035132864845:web:6508bc026762f4887f8f04"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkVideos() {
  console.log('--- CHECKING FIRESTORE VIDEOS COLLECTION ---');
  try {
    const vSnap = await getDocs(collection(db, 'videos'));
    console.log(`Total video docs found: ${vSnap.size}`);
    vSnap.forEach((d) => {
      console.log(`ID: ${d.id}`);
      console.log('Data:', JSON.stringify(d.data(), null, 2));
    });

    console.log('--- CHECKING FIRESTORE POSTS COLLECTION FOR VIDEO POSTS ---');
    const pSnap = await getDocs(collection(db, 'posts'));
    console.log(`Total posts found: ${pSnap.size}`);
    pSnap.forEach((d) => {
      const data = d.data();
      if (data.videoUrl || data.type === 'video' || data.mediaType === 'video') {
        console.log(`Post ID: ${d.id} has video!`, JSON.stringify(data, null, 2));
      }
    });

    console.log('--- CHECKING FIRESTORE USERS COLLECTION ---');
    const uSnap = await getDocs(collection(db, 'users'));
    console.log(`Total users found: ${uSnap.size}`);
    uSnap.forEach((d) => {
      console.log(`User ID: ${d.id}, username: @${d.data().username}, videosCount: ${d.data().videosCount}`);
    });
  } catch (err) {
    console.error('Diagnostic error:', err);
  }
}

checkVideos().then(() => process.exit(0));
