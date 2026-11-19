import { createContext, useContext } from 'react';

export const HrmsSession = createContext({ user: null, logout: () => {} });
export const useHrmsSession = () => useContext(HrmsSession);
