import 'dotenv/config';

async function testOAuth() {
  const apiUrl = 'http://localhost:3001/api/v1';
  
  console.log('🔑 Testing OAuth flow for email: hungblockchain06@gmail.com');
  console.log('API URL:', apiUrl);
  
  // Giả lập token OAuth từ Clerk (thường client sẽ có token này sau khi OAuth thành công)
  // Trong thực tế, bạn sẽ nhận được token này từ Clerk client-side
  
  console.log('\n📋 Available authentication methods:');
  console.log('1. POST /auth/login - Password login (đã có password)');
  console.log('2. POST /auth/oauth/exchange - OAuth exchange (cần Clerk session token)');
  
  console.log('\n✅ Recommendation:');
  console.log('Để sử dụng OAuth, bạn cần:');
  console.log('1. Tạo Clerk session từ client-side (web app)');  
  console.log('2. Gửi session token tới /auth/oauth/exchange endpoint');
  
  console.log('\nVì bạn đã có password được set, có thể test password login:');
  
  try {
    const loginResponse = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.TEST_LOGIN_EMAIL,
        password: process.env.TEST_LOGIN_PASSWORD
      })
    });
    
    if (loginResponse.ok) {
      const data = await loginResponse.json();
      console.log('✅ Password login works!');
      console.log('Role:', data.data.role);
      console.log('Token type:', data.data.tokenType);
    } else {
      const error = await loginResponse.text();
      console.log('❌ Password login failed:', error);
    }
  } catch (err) {
    console.log('❌ API connection error:', err.message);
  }
}

testOAuth().catch(console.error);
