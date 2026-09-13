import 'dotenv/config';
import { clerkClient } from '@clerk/express';

async function fixPassword() {
  const clerkUserId = 'user_3IR75pb1XebQkooeB8FhJGlQW3X';
  const newPassword = 'Kh0ng@Qu3n#M@tKh4u$2024'; // Strong password
  
  try {
    console.log('Attempting to set password for Clerk user...');
    
    // Set password for the user
    const updatedUser = await clerkClient.users.updateUser(clerkUserId, {
      password: newPassword
    });
    
    console.log('✅ Password set successfully!');
    console.log('New password:', newPassword);
    console.log('Password enabled:', updatedUser.passwordEnabled);
    
    // Test the new password
    console.log('\nTesting new password...');
    try {
      await clerkClient.users.verifyPassword({ 
        userId: clerkUserId, 
        password: newPassword 
      });
      console.log('✅ Password verification successful!');
    } catch (verifyError) {
      console.log('❌ Password verification failed:');
      console.log('Error:', verifyError.errors?.[0]?.message || verifyError.message);
    }
    
  } catch (err) {
    console.error('❌ Failed to set password:');
    console.error('Error:', err.errors?.[0]?.message || err.message);
    console.error('Error Code:', err.errors?.[0]?.code || err.code);
    
    if (err.errors?.[0]?.code === 'form_password_pwned') {
      console.log('\n💡 Password is too common. Try a stronger password.');
    }
  }
}

fixPassword().catch(console.error);