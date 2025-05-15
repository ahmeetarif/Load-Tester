import { FlowLoader } from './flow-loader.js';

const test = new FlowLoader({
  number: 50,
  concurrent: 5,
  flow: [
    {
      name: 'Get Token',
      method: 'POST', 
      url: 'https://api.dropyonline.com/api/v1/auth/login',
      data: { email: 'firatanil995@gmail.com', password: 'Ahmet2024' },
      saveAs: 'auth'
    },
    {
      name: 'Get Marketplaces',
      method: 'GET', 
      url: 'https://api.dropyonline.com/api/v1/account/marketplaces',
      headers: {
        'Authorization': 'Bearer {{auth.Result.accessToken}}',
      }
    }
  ]
});

test.run();