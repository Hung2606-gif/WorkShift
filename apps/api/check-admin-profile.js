import 'dotenv/config';

async function checkAdminProfile() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = 'hungblockchain06@gmail.com';
  
  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json'
  };
  
  console.log('🔍 Checking admin profile for:', adminEmail);
  
  try {
    // Check user in database
    const response = await fetch(
      `${supabaseUrl}/rest/v1/users?select=*&email=eq.${encodeURIComponent(adminEmail)}`,
      { headers }
    );
    
    if (!response.ok) {
      console.error('❌ API Error:', response.status);
      return;
    }
    
    const users = await response.json();
    
    if (users.length === 0) {
      console.log('❌ No user found in database');
      console.log('\n💡 Creating admin profile...');
      
      // Create admin user
      const createResponse = await fetch(`${supabaseUrl}/rest/v1/users`, {
        method: 'POST',
        headers: {
          ...headers,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          email: adminEmail,
          full_name: 'System Admin',
          role: 'ADMIN',
          is_active: true,
          clerk_user_id: 'user_3IR75pb1XebQkooeB8FhJGlQW3X'
        })
      });
      
      if (createResponse.ok) {
        const newUser = await createResponse.json();
        console.log('✅ Admin profile created successfully!');
        console.log(newUser);
      } else {
        const error = await createResponse.text();
        console.log('❌ Failed to create profile:', error);
      }
    } else {
      console.log('✅ Admin profile exists:');
      console.log(JSON.stringify(users[0], null, 2));
      
      if (!users[0].is_active) {
        console.log('\n⚠️  User is not active. Activating...');
        const updateResponse = await fetch(
          `${supabaseUrl}/rest/v1/users?id=eq.${users[0].id}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ is_active: true })
          }
        );
        
        if (updateResponse.ok) {
          console.log('✅ User activated');
        }
      }
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

checkAdminProfile();