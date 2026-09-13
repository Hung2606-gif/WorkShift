import 'dotenv/config';

async function debugAuth() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const systemAdminEmail = process.env.SYSTEM_ADMIN_EMAIL?.trim().toLowerCase() || 'hungblockchain06@gmail.com';
  
  console.log('System Admin Email:', systemAdminEmail);
  console.log('Supabase URL:', supabaseUrl);
  
  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  
  try {
    // Query users table using REST API
    const response = await fetch(`${supabaseUrl}/rest/v1/users?select=id,clerk_user_id,full_name,email,role,is_active&email=eq.${encodeURIComponent(systemAdminEmail)}`, {
      method: 'GET',
      headers
    });
    
    if (!response.ok) {
      console.error('API Error:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('Error details:', errorText);
      return;
    }
    
    const users = await response.json();
    
    console.log('\nUsers found with system admin email:');
    console.log(users);
    
    if (users && users.length > 0) {
      const user = users[0];
      if (!user.clerk_user_id) {
        console.log('\n❌ Problem found: User exists but clerk_user_id is null');
        console.log('This user needs to be linked with a Clerk account');
        console.log('Solutions:');
        console.log('1. Delete this user and create new via OAuth2 signup');
        console.log('2. Link existing user with Clerk account via admin API');
      } else {
        console.log('✅ User is properly linked with Clerk ID:', user.clerk_user_id);
      }
    } else {
      console.log('\n❌ No user found with system admin email');
      console.log('User needs to be created');
    }
    
    // Query all users
    const allResponse = await fetch(`${supabaseUrl}/rest/v1/users?select=id,clerk_user_id,full_name,email,role,is_active`, {
      method: 'GET',
      headers
    });
    
    if (allResponse.ok) {
      const allUsers = await allResponse.json();
      console.log('\nAll users in database:');
      allUsers.forEach(user => {
        console.log(`- ${user.email} (${user.role}) - Clerk ID: ${user.clerk_user_id || 'NOT SET'} - Active: ${user.is_active}`);
      });
    }
    
  } catch (err) {
    console.error('Debug error:', err);
  }
}

debugAuth().catch(console.error);