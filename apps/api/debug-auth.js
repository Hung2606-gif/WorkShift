import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function debugAuth() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const systemAdminEmail = process.env.SYSTEM_ADMIN_EMAIL?.trim().toLowerCase() || 'hungblockchain06@gmail.com';
  
  console.log('System Admin Email:', systemAdminEmail);
  console.log('Company Email Domain:', process.env.COMPANY_EMAIL_DOMAIN);
  
  // Tạo client với config tối giản
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: {} },
    realtime: { disabled: true },
    db: { schema: 'public' }
  });
  
  try {
    // Kiểm tra user hiện tại trong database
    const { data: users, error } = await supabase
      .from('users')
      .select('id, clerk_user_id, full_name, email, role, is_active')
      .eq('email', systemAdminEmail);
      
    if (error) {
      console.error('Error querying users:', error);
      return;
    }
    
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
    
    // Kiểm tra tất cả users
    const { data: allUsers, error: allError } = await supabase
      .from('users')
      .select('id, clerk_user_id, full_name, email, role, is_active');
      
    if (!allError && allUsers) {
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