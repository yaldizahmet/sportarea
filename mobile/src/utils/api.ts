import AsyncStorage from '@react-native-async-storage/async-storage';

export const apiFetch = async (url: string, options: RequestInit = {}) => {
  const token = await AsyncStorage.getItem('userToken');
  
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  return fetch(url, {
    ...options,
    headers,
  });
};
