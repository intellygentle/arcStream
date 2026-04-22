// frontend/src/lib/api.ts
import axios, { AxiosInstance } from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE,
  timeout: 120000, // Increased to 120s for video upload processing
});

export interface PaymentDetails {
  resource: string;
  price: string;
  currency: 'USDC';
  chain: 'ARC-TESTNET';
  nonce: string;
  maxAmountRequired: string;
  recipient: string;
  facilitator?: string;
}

export interface SignedPayment {
  signature: string;
  paymentDetails: PaymentDetails;
  payerAddress: string;
}

export const authAPI = {
  getNonce: (address: string) => api.get(`/auth/nonce?address=${address}`),
  linkWallet: (data: any) => api.post('/auth/link', data),
};

export const walletAPI = {
  getState: (address: string) => api.get(`/wallets/${address}/state`),
  deploy: (address: string) => api.post('/wallets/deploy', { address }),
};

export const videoAPI = {
  list: (q?: string) => api.get(`/videos${q ? `?q=${q}` : ''}`),
  
  getVideo: (id: string) => api.get(`/videos/${id}`),
  
  create: (payload: FormData | Record<string, any>, eoaAddress: string) => {
    const isFormData = payload instanceof FormData;
    
    return api.post('/videos', payload, {
      headers: { 
        Authorization: `Bearer ${eoaAddress}`,
        ...(isFormData ? {} : { 'Content-Type': 'application/json' })
      },
      timeout: 180000, // 3 minutes
    });
  },
  
  delete: (videoId: string, eoaAddress: string) =>
    api.delete(`/videos/${videoId}`, {
      headers: { Authorization: `Bearer ${eoaAddress}` }
    }),
  
  signChunk: (videoId: string, chunkIndex: number, eoaAddress: string) => 
    api.post(`/videos/${videoId}/sign/${chunkIndex}`, {}, {
      headers: { Authorization: `Bearer ${eoaAddress}` }
    }),
  
  requestChunkAccess: (videoId: string, chunkIndex: number, signedPayment?: SignedPayment) => {
    const headers: Record<string, string> = {};
    if (signedPayment) {
      // ✅ Include the signature AND payer address in the auth header
      headers['X-Payment-Authorization'] = `${signedPayment.signature}:${signedPayment.payerAddress}`;
      headers['X-Payment-Nonce'] = signedPayment.paymentDetails.nonce;
      headers['X-Payment-Price'] = signedPayment.paymentDetails.price;
      headers['X-Creator-Wallet'] = signedPayment.paymentDetails.recipient;
    }
    return api.post(`/videos/${videoId}/stream/${chunkIndex}`, {}, { headers });
  },
  
  getPaidChunks: (videoId: string, eoaAddress: string) =>
    api.get(`/videos/${videoId}/paid-chunks`, {
      headers: { Authorization: `Bearer ${eoaAddress}` }
    }),


      getUploadToken: (filename: string, contentType: string, eoaAddress: string) =>
    api.post('/videos/upload-token', { filename, contentType }, {
      headers: { Authorization: `Bearer ${eoaAddress}` }
    }),

  // Confirm upload and create video record
  confirmUpload: (data: {
    videoUrl: string;
    title: string;
    description: string;
    durationSeconds: string;
    chunkUnit: string;
    chunkValue: string;
    pricePerChunk: string;
  }, eoaAddress: string) =>
    api.post('/videos/confirm-upload', data, {
      headers: { Authorization: `Bearer ${eoaAddress}` }
    }),

};

export const x402Utils = {
  parsePaymentDetails: (response: any): PaymentDetails | null => {
    const headers = response?.headers || {};
    const body = response?.data || {};
    const details = body.paymentDetails || body || {};
    
    if (headers['x-payment-required'] !== 'true' && response?.status !== 402) return null;
    
    return {
      resource: headers['x-payment-resource'] || details.resource || '',
      price: headers['x-payment-price'] || details.price || '0.001',
      currency: 'USDC',
      chain: 'ARC-TESTNET',
      nonce: headers['x-payment-nonce'] || details.nonce || '',
      maxAmountRequired: headers['x-payment-max-amount'] || details.maxAmountRequired || headers['x-payment-price'] || '0.001',
      recipient: headers['x-creator-wallet'] || details.recipient || '',
      facilitator: headers['x-payment-facilitator'] || details.facilitator || 'https://facilitator.x402.org',
    };
  },
};

// Request interceptor for debugging
api.interceptors.request.use(
  (config) => {
    console.log(`📤 ${config.method?.toUpperCase()} ${config.url}`, 
      config.data instanceof FormData ? '[FormData]' : config.data);
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for debugging
api.interceptors.response.use(
  (response) => {
    console.log(`📥 ${response.status} ${response.config.url}`);
    return response;
  },
  (error) => {
    console.error(`❌ API Error:`, error.response?.status, error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default api;