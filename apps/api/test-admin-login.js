import 'dotenv/config';

async function testLogin() {
  const apiUrl = 'http://localhost:3001/api/v1';
  const credentials = {
    email: 'hungblockchain06@gmail.com',
    password: 'Kh0ng@Qu3n#M@tKh4u$2024'
  };
  
  console.log('🔐 Testing login...');
  console.log('Email:', credentials.email);
  console.log('API:', apiUrl);
  
  try {
    const response = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(credentials)
    });
    
    console.log('\n📊 Response Status:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Login successful!');
      console.log('\nResponse data:');
      console.log(JSON.stringify(data, null, 2));
      
      // Test profile endpoint
      console.log('\n🔍 Testing profile endpoint...');
      const profileResponse = await fetch(`${apiUrl}/profile`, {
        headers: {
          'Authorization': `Bearer ${data.data.accessToken}`
        }
      });
      
      if (profileResponse.ok) {
        const profile = await profileResponse.json();
        console.log('✅ Profile retrieved:');
        console.log(JSON.stringify(profile, null, 2));
      } else {
        const profileError = await profileResponse.text();
        console.log('❌ Profile error:', profileError);
      }
    } else {
      const error = await response.text();
      console.log('❌ Login failed!');
      console.log('Error:', error);
    }
  } catch (err) {
    console.error('❌ Connection error:', err.message);
    console.log('\n💡 Make sure API is running on port 3001');
  }
}

testLogin();