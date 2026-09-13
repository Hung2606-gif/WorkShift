import 'dotenv/config';
import { clerkClient } from '@clerk/express';

async function debugClerk() {
  const clerkUserId = 'user_3IR75pb1XebQkooeB8FhJGlQW3X';
  
  console.log('Clerk Config:');
  console.log('CLERK_PUBLISHABLE_KEY:', process.env.CLERK_PUBLISHABLE_KEY);
  console.log('CLERK_SECRET_KEY:', process.env.CLERK_SECRET_KEY ? 'SET' : 'NOT SET');
  
  try {
    // Get user info from Clerk
    console.log('\nFetching user from Clerk...');
    const user = await clerkClient.users.getUser(clerkUserId);
    
    console.log('Clerk User Info:');
    console.log('- ID:', user.id);
    console.log('- Primary Email:', user.primaryEmailAddress?.emailAddress);
    console.log('- First Name:', user.firstName);
    console.log('- Last Name:', user.lastName);
    console.log('- Created:', user.createdAt);
    console.log('- Last Sign In:', user.lastSignInAt);
    console.log('- Banned:', user.banned);
    console.log('- Locked:', user.locked);
    console.log('- Has Password:', user.hasPasswordBasedAccount);
    console.log('- Password Enabled:', user.passwordEnabled);
    
    // Test password verification (with wrong password to see error)
    console.log('\nTesting password verification...');
    try {
      await clerkClient.users.verifyPassword({ 
        userId: clerkUserId, 
        password: 'wrong_password_test' 
      });
      console.log('✅ Password verification successful (this should not happen with wrong password)');
    } catch (error) {
      console.log('❌ Password verification failed (expected with wrong password):');
      console.log('Error:', error.errors?.[0]?.message || error.message);
      console.log('Error Code:', error.errors?.[0]?.code || error.code);
    }
    
  } catch (err) {
    console.error('Clerk API error:', err);
    console.error('Error details:', err.errors || err.message);
  }
}

debugClerk().catch(console.error);