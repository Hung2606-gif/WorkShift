import 'dotenv/config';

async function testAuth() {
  const apiUrl = `http://localhost:${process.env.PORT || 3001}/api/v1`;
  const email = process.env.TEST_LOGIN_EMAIL;
  const password = process.env.TEST_LOGIN_PASSWORD;
  if (!email || !password) throw new Error('Set TEST_LOGIN_EMAIL and TEST_LOGIN_PASSWORD before running this smoke test.');
  
  console.log('Testing full authentication flow...');
  console.log('API URL:', apiUrl);
  console.log('Email:', email);
  
  try {
    // Test login
    const loginResponse = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        password: password
      })
    });
    
    console.log('\nLogin Response Status:', loginResponse.status);
    
    if (!loginResponse.ok) {
      const errorText = await loginResponse.text();
      console.log('Login Error:', errorText);
      return;
    }
    
    const loginData = await loginResponse.json();
    console.log('✅ Login successful!');
    console.log('Token type:', loginData.data.tokenType);
    console.log('Role:', loginData.data.role);
    console.log('Expires in:', loginData.data.expiresIn);
    
    // Test protected endpoint
    console.log('\nTesting protected endpoint...');
    const profileResponse = await fetch(`${apiUrl}/me`, {
      headers: {
        'Authorization': `${loginData.data.tokenType} ${loginData.data.accessToken}`
      }
    });
    
    console.log('Profile Response Status:', profileResponse.status);
    
    if (profileResponse.ok) {
      const profileData = await profileResponse.json();
      console.log('✅ Protected endpoint accessible!');
      console.log('Profile:', profileData);
    } else {
      const profileError = await profileResponse.text();
      console.log('❌ Protected endpoint error:', profileError);
    }
    
  } catch (err) {
    console.error('Test error:', err.message);
  }
}

// Check if API is running first
async function checkAPI() {
  const apiUrl = `http://localhost:${process.env.PORT || 3001}`;
  
  console.log('Checking API at:', apiUrl);
  
  try {
    const response = await fetch(`${apiUrl}/health`);
    console.log('API response status:', response.status);
    if (response.ok) {
      console.log('✅ API is running');
      return true;
    } else {
      console.log('❌ API responded with error status');
      return false;
    }
  } catch (err) {
    console.log('❌ API is not running. Error:', err.message);
    console.log('Please start the API first with: npm run dev');
    return false;
  }
}

async function main() {
  console.log('Starting main function...');
  const apiRunning = await checkAPI();
  console.log('API running:', apiRunning);
  
  if (apiRunning) {
    await testAuth();
  } else {
    console.log('Skipping auth test because API is not running');
  }
}

main().then(() => {
  console.log('Script completed');
}).catch(err => {
  console.error('Script error:', err);
});
