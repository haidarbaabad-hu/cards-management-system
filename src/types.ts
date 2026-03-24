export type TransactionType = 
  | 'DELIVERY_TO_DISTRIBUTOR' // تسليم كروت لموزع
  | 'DISTRIBUTION_TO_CLIENT'  // توزيع كروت لعميل
  | 'COLLECTION_FROM_CLIENT'  // تحصيل من عميل
  | 'DEPOSIT_FROM_DISTRIBUTOR' // إيداع من موزع
  | 'OTHER_EXPENSE'; // مصروفات اخرى

export interface Category {
  id: string;
  name: string;
  price: number;
}

export interface Distributor {
  id: string;
  name: string;
  stock: Record<string, number>; // categoryId -> quantity
}

export interface Client {
  id: string;
  name: string;
}

export interface TransactionItem {
  categoryId: string;
  quantity: number;
  price: number;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  distributorId?: string;
  clientId?: string;
  items?: TransactionItem[];
  amount?: number; // for collection/deposit
  date: string;
  details: string;
}
