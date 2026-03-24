/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, 
  Trash2, 
  Edit2, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Users, 
  CreditCard, 
  History, 
  BarChart3, 
  LayoutDashboard,
  Save,
  X,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Wallet,
  Package,
  FileText,
  Printer,
  Calendar
} from 'lucide-react';
import html2pdf from 'html2pdf.js';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  PieChart,
  Pie
} from 'recharts';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { 
  Category, 
  Distributor, 
  Client, 
  Transaction, 
  TransactionType, 
  TransactionItem 
} from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy,
  setDoc
} from 'firebase/firestore';

// Firebase Configuration
const firebaseConfig = {
  apiKey: 'AIzaSyBbromp0P5U6Gi2o8ODlNN1WoQtlfKq-LY',
  authDomain: 'cards-management-system-534b4.firebaseapp.com',
  projectId: 'cards-management-system-534b4',
  storageBucket: 'cards-management-system-534b4.firebasestorage.app',
  messagingSenderId: '1082497720645',
  appId: '1:1082497720645:web:edb576805d345aaf799e2c'
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Initial Data (Cleared for Firebase)
const INITIAL_CATEGORIES: Category[] = [];
const INITIAL_DISTRIBUTORS: Distributor[] = [];
const INITIAL_CLIENTS: Client[] = [];

type Tab = 'dashboard' | 'categories' | 'distributors' | 'clients' | 'transactions' | 'reports';

interface DistStats {
  totalDelivered: number;
  totalDeposited: number;
  totalExpenses: number;
  totalCollected: number;
  stock: Record<string, number>;
  deliveredValue: number;
  totalStockValue: number;
}

interface ClientStats {
  totalReceivedValue: number;
  totalCollected: number;
  catReceived: Record<string, number>;
}

export default function App() {
  // State
  const [categories, setCategories] = useState<Category[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [showModal, setShowModal] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'category' | 'distributor' | 'client' | 'transaction', id: string, name: string } | null>(null);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [reportConfig, setReportConfig] = useState<{
    show: boolean;
    type: 'distributor' | 'client';
    entityId: string;
    entityName: string;
    startDate: string;
    endDate: string;
    reportType: 'full';
    distributorFilter: string;
    dateRangeType: 'until_today' | 'custom';
  }>({
    show: false,
    type: 'distributor',
    entityId: '',
    entityName: '',
    startDate: '',
    endDate: format(new Date(), 'yyyy-MM-dd'),
    reportType: 'full',
    distributorFilter: 'all',
    dateRangeType: 'until_today'
  });
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const generatePDF = () => {
    const { type, entityId, entityName, startDate, endDate, distributorFilter, dateRangeType } = reportConfig;
    
    // Filter transactions
    const filteredTransactions = transactions
      .filter(tx => {
        const date = tx.date.split('T')[0];
        
        // Date filter
        let dateMatch = true;
        if (dateRangeType === 'custom') {
          dateMatch = (!startDate || date >= startDate) && (!endDate || date <= endDate);
        } else {
          const today = format(new Date(), 'yyyy-MM-dd');
          dateMatch = date <= today;
        }

        // Entity filter
        let entityMatch = type === 'distributor' ? tx.distributorId === entityId : tx.clientId === entityId;
        
        // Distributor filter for client reports
        if (type === 'client' && distributorFilter && distributorFilter !== 'all') {
          entityMatch = entityMatch && tx.distributorId === distributorFilter;
        }

        // Additional filter for distributor reports: only show specific types
        if (type === 'distributor') {
          const allowedTypes: TransactionType[] = [
            'DELIVERY_TO_DISTRIBUTOR',
            'DEPOSIT_FROM_DISTRIBUTOR',
            'OTHER_EXPENSE'
          ];
          entityMatch = entityMatch && allowedTypes.includes(tx.type);
        }

        return dateMatch && entityMatch;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Flat map transactions to split multi-item ones into separate rows
    const flattenedTransactions = filteredTransactions.flatMap(tx => {
      if (tx.items && tx.items.length > 1) {
        return tx.items.map(item => ({
          ...tx,
          items: [item]
        }));
      }
      return [tx];
    });

    // Calculate cumulative balance
    let cumulativeBalance = 0;
    const reportData = flattenedTransactions.map(tx => {
      let debit = 0;
      let credit = 0;
      let count = 0;
      let categoryName = '-';

      if (type === 'distributor') {
        if (tx.type === 'DELIVERY_TO_DISTRIBUTOR') {
          count = tx.items?.[0]?.quantity || 0;
          debit = (tx.items?.[0]?.quantity || 0) * (tx.items?.[0]?.price || 0);
          categoryName = categories.find(c => c.id === tx.items?.[0]?.categoryId)?.name || '-';
        } else if (tx.type === 'DEPOSIT_FROM_DISTRIBUTOR') {
          credit = tx.amount || 0;
        } else if (tx.type === 'OTHER_EXPENSE') {
          credit = tx.amount || 0;
        }
      } else { // client
        if (tx.type === 'DISTRIBUTION_TO_CLIENT') {
          count = tx.items?.[0]?.quantity || 0;
          debit = (tx.items?.[0]?.quantity || 0) * (tx.items?.[0]?.price || 0);
          categoryName = categories.find(c => c.id === tx.items?.[0]?.categoryId)?.name || '-';
        } else if (tx.type === 'COLLECTION_FROM_CLIENT') {
          credit = tx.amount || 0;
        }
      }

      cumulativeBalance += (debit - credit);

      const dist = distributors.find(d => d.id === tx.distributorId);
      const distInfo = type === 'client' && distributorFilter === 'all' && dist ? ` [${dist.name}]` : '';

      return {
        date: format(new Date(tx.date), 'dd/MM/yyyy'),
        count,
        category: categoryName,
        details: (tx.details || '-') + distInfo,
        debit,
        credit,
        balance: cumulativeBalance
      };
    });

    const totalDebit = reportData.reduce((acc, curr) => acc + curr.debit, 0);
    const totalCredit = reportData.reduce((acc, curr) => acc + curr.credit, 0);

    const element = document.createElement('div');
    element.dir = 'rtl';
    element.style.padding = '40px';
    element.style.fontFamily = 'Arial, sans-serif';
    element.style.backgroundColor = '#fff';

    const distName = distributorFilter === 'all' ? 'كل الموزعين' : (distributors.find(d => d.id === distributorFilter)?.name || 'غير معروف');

    element.innerHTML = `
      <div style="text-align: center; margin-bottom: 30px; border-bottom: 3px solid #4f46e5; padding-bottom: 20px;">
        <h1 style="color: #4f46e5; margin: 0; font-size: 32px; font-weight: bold;">نظام إدارة الكروت</h1>
        <h2 style="color: #1e293b; margin: 10px 0 15px 0; font-size: 22px; font-weight: bold;">كشف حساب ${type === 'distributor' ? 'موزع' : 'عميل'}: ${entityName}</h2>
        
        <div style="display: flex; justify-content: center; gap: 40px; margin-top: 10px; color: #475569; font-size: 16px;">
          ${type === 'client' ? `<span><strong>الموزع:</strong> ${distName}</span>` : ''}
          <span><strong>الفترة:</strong> ${dateRangeType === 'custom' ? `${startDate || 'البداية'} إلى ${endDate || 'اليوم'}` : 'حتى اليوم'}</span>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 14px;">
        <thead>
          <tr style="background-color: #4f46e5; color: white;">
            <th style="padding: 12px 8px; text-align: right; border: 1px solid #4f46e5;">التاريخ</th>
            <th style="padding: 12px 8px; text-align: center; border: 1px solid #4f46e5;">العدد</th>
            <th style="padding: 12px 8px; text-align: center; border: 1px solid #4f46e5;">الفئة</th>
            <th style="padding: 12px 8px; text-align: center; border: 1px solid #4f46e5;">التفاصيل</th>
            <th style="padding: 12px 8px; text-align: center; border: 1px solid #4f46e5;">عليه (مدين)</th>
            <th style="padding: 12px 8px; text-align: center; border: 1px solid #4f46e5;">له (دائن)</th>
            <th style="padding: 12px 8px; text-align: center; border: 1px solid #4f46e5;">الرصيد</th>
          </tr>
        </thead>
        <tbody>
          ${reportData.map((row, index) => `
            <tr style="background-color: ${index % 2 === 0 ? '#ffffff' : '#f8fafc'};">
              <td style="padding: 10px 8px; border: 1px solid #e2e8f0; white-space: nowrap;">${row.date}</td>
              <td style="padding: 10px 8px; text-align: center; border: 1px solid #e2e8f0;">${row.count || '-'}</td>
              <td style="padding: 10px 8px; text-align: center; border: 1px solid #e2e8f0;">${row.category}</td>
              <td style="padding: 10px 8px; text-align: center; border: 1px solid #e2e8f0; font-size: 11px; color: #64748b;">${row.details}</td>
              <td style="padding: 10px 8px; text-align: center; color: ${row.debit > 0 ? '#e11d48' : '#94a3b8'}; font-weight: ${row.debit > 0 ? 'bold' : 'normal'}; border: 1px solid #e2e8f0;">${row.debit > 0 ? row.debit.toLocaleString() : '-'}</td>
              <td style="padding: 10px 8px; text-align: center; color: ${row.credit > 0 ? '#059669' : '#94a3b8'}; font-weight: ${row.credit > 0 ? 'bold' : 'normal'}; border: 1px solid #e2e8f0;">${row.credit > 0 ? row.credit.toLocaleString() : '-'}</td>
              <td style="padding: 10px 8px; text-align: center; font-weight: bold; color: #2563eb; border: 1px solid #e2e8f0; background-color: #eff6ff;">${row.balance.toLocaleString()}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="margin-top: 30px; padding: 25px; background-color: #f1f5f9; border-radius: 16px; border: 2px solid #e2e8f0; max-width: 400px; margin-right: auto;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
          <span style="font-weight: bold; color: #475569; font-size: 16px;">إجمالي عليه:</span>
          <span style="font-weight: bold; color: #e11d48; font-size: 20px;">${totalDebit.toLocaleString()} ر.ي</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
          <span style="font-weight: bold; color: #475569; font-size: 16px;">إجمالي له:</span>
          <span style="font-weight: bold; color: #059669; font-size: 20px;">${totalCredit.toLocaleString()} ر.ي</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding-top: 12px; border-top: 2px solid #cbd5e1;">
          <span style="font-weight: bold; color: #1e293b; font-size: 22px;">الرصيد النهائي:</span>
          <span style="font-weight: bold; color: #2563eb; font-size: 24px;">${cumulativeBalance.toLocaleString()} ر.ي</span>
        </div>
      </div>

      <div style="margin-top: 80px; text-align: center; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
        <p>تم استخراج هذا التقرير بواسطة نظام إدارة الكروت</p>
        <p>تاريخ ووقت الإنشاء: ${format(new Date(), 'dd/MM/yyyy HH:mm:ss')}</p>
      </div>
    `;

    const opt = {
      margin: 10,
      filename: `كشف_حساب_${entityName}_${format(new Date(), 'yyyyMMdd')}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const }
    };

    html2pdf().from(element).set(opt).save().then(() => {
      setReportConfig(prev => ({ ...prev, show: false }));
      setSuccessMessage('تم إنشاء التقرير بنجاح');
    });
  };

  // Firebase Sync
  useEffect(() => {
    const unsubCategories = onSnapshot(collection(db, 'categories'), (snapshot) => {
      setCategories(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Category)));
    });
    const unsubDistributors = onSnapshot(collection(db, 'distributors'), (snapshot) => {
      setDistributors(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Distributor)));
    });
    const unsubClients = onSnapshot(collection(db, 'clients'), (snapshot) => {
      setClients(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Client)));
    });
    const unsubTransactions = onSnapshot(query(collection(db, 'transactions'), orderBy('date', 'desc')), (snapshot) => {
      setTransactions(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Transaction)));
    });

    return () => {
      unsubCategories();
      unsubDistributors();
      unsubClients();
      unsubTransactions();
    };
  }, []);

  // Success message auto-hide
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Calculations
  const calculations = useMemo(() => {
    const distStats: Record<string, DistStats> = {};
    const clientStats: Record<string, ClientStats> = {};
    const catStats: Record<string, number> = {};
    const clientDebtPerDistributor: Record<string, Record<string, number>> = {};
    const catValueStats: Record<string, number> = {};

    // Initialize
    distributors.forEach(d => {
      distStats[d.id] = {
        totalDelivered: 0,
        totalDeposited: 0,
        totalExpenses: 0,
        totalCollected: 0,
        stock: { ...d.stock },
        deliveredValue: 0,
        totalStockValue: 0
      };
      clientDebtPerDistributor[d.id] = {};
      clients.forEach(c => {
        clientDebtPerDistributor[d.id][c.id] = 0;
      });
    });

    clients.forEach(c => {
      clientStats[c.id] = {
        totalReceivedValue: 0,
        totalCollected: 0,
        catReceived: {} as Record<string, number>
      };
    });

    categories.forEach(cat => {
      catStats[cat.id] = 0;
      catValueStats[cat.id] = 0;
    });

    // Process Transactions
    transactions.forEach(tx => {
      if (tx.type === 'DELIVERY_TO_DISTRIBUTOR' && tx.distributorId) {
        const stats = distStats[tx.distributorId];
        tx.items?.forEach(item => {
          const val = item.quantity * item.price;
          stats.deliveredValue += val;
          stats.stock[item.categoryId] = (stats.stock[item.categoryId] || 0) + item.quantity;
        });
      } else if (tx.type === 'DISTRIBUTION_TO_CLIENT' && tx.distributorId && tx.clientId) {
        const dStats = distStats[tx.distributorId];
        const cStats = clientStats[tx.clientId];
        tx.items?.forEach(item => {
          const val = item.quantity * item.price;
          dStats.stock[item.categoryId] = (dStats.stock[item.categoryId] || 0) - item.quantity;
          cStats.totalReceivedValue += val;
          cStats.catReceived[item.categoryId] = (cStats.catReceived[item.categoryId] || 0) + item.quantity;
          catStats[item.categoryId] += item.quantity;
          catValueStats[item.categoryId] += val;
          
          // Track debt per client per distributor
          if (clientDebtPerDistributor[tx.distributorId]) {
            clientDebtPerDistributor[tx.distributorId][tx.clientId] = (clientDebtPerDistributor[tx.distributorId][tx.clientId] || 0) + val;
          }
        });
      } else if (tx.type === 'COLLECTION_FROM_CLIENT' && tx.distributorId && tx.clientId) {
        const dStats = distStats[tx.distributorId];
        const cStats = clientStats[tx.clientId];
        dStats.totalCollected += tx.amount || 0;
        cStats.totalCollected += tx.amount || 0;

        // Decrease debt per client per distributor
        if (clientDebtPerDistributor[tx.distributorId]) {
          clientDebtPerDistributor[tx.distributorId][tx.clientId] = (clientDebtPerDistributor[tx.distributorId][tx.clientId] || 0) - (tx.amount || 0);
        }
      } else if (tx.type === 'DEPOSIT_FROM_DISTRIBUTOR' && tx.distributorId) {
        const dStats = distStats[tx.distributorId];
        dStats.totalDeposited += tx.amount || 0;
      } else if (tx.type === 'OTHER_EXPENSE' && tx.distributorId) {
        const dStats = distStats[tx.distributorId];
        dStats.totalExpenses += tx.amount || 0;
      }
    });

    // Calculate total stock value for each distributor
    distributors.forEach(d => {
      const stats = distStats[d.id];
      stats.totalStockValue = Object.entries(stats.stock).reduce((total, [catId, qty]) => {
        const cat = categories.find(c => c.id === catId);
        return total + (qty * (cat?.price || 0));
      }, 0);
    });

    return { distStats, clientStats, catStats, catValueStats, clientDebtPerDistributor };
  }, [transactions, distributors, clients, categories]);

  // Handlers
  const addCategory = async (cat: Omit<Category, 'id'>) => {
    try {
      await addDoc(collection(db, 'categories'), cat);
      setShowModal(null);
      setSuccessMessage('تمت إضافة الفئة بنجاح');
    } catch (e) {
      console.error(e);
    }
  };

  const updateCategory = async (cat: Category) => {
    try {
      const { id, ...data } = cat;
      await updateDoc(doc(db, 'categories', id), data);
      setShowModal(null);
      setEditingItem(null);
      setSuccessMessage('تم تحديث الفئة بنجاح');
    } catch (e) {
      console.error(e);
    }
  };

  const deleteCategory = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'categories', id));
      setConfirmDelete(null);
      setSuccessMessage('تم حذف الفئة');
    } catch (e) {
      console.error(e);
    }
  };

  const addDistributor = async (name: string) => {
    try {
      await addDoc(collection(db, 'distributors'), { name, stock: {} });
      setShowModal(null);
      setSuccessMessage('تمت إضافة الموزع بنجاح');
    } catch (e) {
      console.error(e);
    }
  };

  const updateDistributor = async (dist: Distributor) => {
    try {
      const { id, ...data } = dist;
      await updateDoc(doc(db, 'distributors', id), data);
      setShowModal(null);
      setEditingItem(null);
      setSuccessMessage('تم تحديث بيانات الموزع بنجاح');
    } catch (e) {
      console.error(e);
    }
  };

  const deleteDistributor = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'distributors', id));
      setConfirmDelete(null);
      setSuccessMessage('تم حذف الموزع');
    } catch (e) {
      console.error(e);
    }
  };

  const addClient = async (name: string) => {
    try {
      await addDoc(collection(db, 'clients'), { name });
      setShowModal(null);
      setSuccessMessage('تمت إضافة العميل بنجاح');
    } catch (e) {
      console.error(e);
    }
  };

  const updateClient = async (client: Client) => {
    try {
      const { id, ...data } = client;
      await updateDoc(doc(db, 'clients', id), data);
      setShowModal(null);
      setEditingItem(null);
      setSuccessMessage('تم تحديث بيانات العميل بنجاح');
    } catch (e) {
      console.error(e);
    }
  };

  const deleteClient = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'clients', id));
      setConfirmDelete(null);
      setSuccessMessage('تم حذف العميل');
    } catch (e) {
      console.error(e);
    }
  };

  const addTransaction = async (tx: Omit<Transaction, 'id'>) => {
    try {
      await addDoc(collection(db, 'transactions'), tx);
      setShowModal(null);
      setSuccessMessage('تمت العملية بنجاح');
    } catch (e) {
      console.error(e);
    }
  };

  const updateTransaction = async (tx: Transaction) => {
    try {
      const { id, ...data } = tx;
      await updateDoc(doc(db, 'transactions', id), data);
      setShowModal(null);
      setEditingItem(null);
      setSuccessMessage('تم تحديث العملية بنجاح');
    } catch (e) {
      console.error(e);
    }
  };

  const deleteTransaction = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'transactions', id));
      setConfirmDelete(null);
      setSuccessMessage('تم حذف العملية');
    } catch (e) {
      console.error(e);
    }
  };

  // UI Components
  const Card = ({ children, className, ...props }: { children: React.ReactNode, className?: string, [key: string]: any }) => (
    <div className={cn("bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden", className)} {...props}>
      {children}
    </div>
  );

  const Modal = ({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h3 className="text-xl font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900" dir="rtl">
      {/* Sidebar / Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 lg:top-0 lg:bottom-0 lg:right-auto lg:w-64 bg-white border-t lg:border-t-0 lg:border-l border-slate-200 z-40">
        <div className="flex lg:flex-col h-full">
          <div className="hidden lg:flex items-center gap-3 p-8">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <CreditCard className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-black tracking-tight text-slate-800">نظام الكروت</h1>
          </div>

          <div className="flex lg:flex-col flex-1 gap-1 p-2 lg:px-4">
            {[
              { id: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard },
              { id: 'categories', label: 'الفئات', icon: Package },
              { id: 'distributors', label: 'الموزعون', icon: Users },
              { id: 'clients', label: 'العملاء', icon: Users },
              { id: 'transactions', label: 'العمليات', icon: History },
              { id: 'reports', label: 'التقارير', icon: BarChart3 },
            ].map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as Tab)}
                className={cn(
                  "flex flex-col lg:flex-row items-center gap-2 lg:gap-3 flex-1 lg:flex-none py-3 px-4 rounded-xl transition-all duration-200",
                  activeTab === item.id 
                    ? "bg-indigo-50 text-indigo-600 font-bold" 
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                )}
              >
                <item.icon className={cn("w-5 h-5", activeTab === item.id ? "text-indigo-600" : "text-slate-400")} />
                <span className="text-[10px] lg:text-sm">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="lg:mr-64 p-4 lg:p-8 pb-24 lg:pb-8">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-3xl font-black text-slate-900">
              {activeTab === 'dashboard' && 'لوحة التحكم'}
              {activeTab === 'categories' && 'إدارة الفئات'}
              {activeTab === 'distributors' && 'إدارة الموزعين'}
              {activeTab === 'clients' && 'إدارة العملاء'}
              {activeTab === 'transactions' && 'سجل العمليات'}
              {activeTab === 'reports' && 'التقارير والتحليلات'}
            </h2>
            <p className="text-slate-500 mt-1">مرحباً بك، إليك ملخص النظام اليوم.</p>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setShowModal('new_tx')}
              className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
            >
              <Plus className="w-5 h-5" />
              عملية جديدة
            </button>
          </div>
        </header>

        {/* Success Toast */}
        {successMessage && (
          <div className="fixed top-8 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 text-white px-6 py-3 rounded-2xl shadow-xl animate-in slide-in-from-top duration-300 flex items-center gap-3">
            <div className="w-6 h-6 bg-white/20 rounded-full flex items-center justify-center">
              <Save className="w-4 h-4" />
            </div>
            <span className="font-bold">{successMessage}</span>
          </div>
        )}

        {/* Tab Content */}
        <div className="space-y-8">
          {activeTab === 'dashboard' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card className="p-6 border-r-4 border-r-indigo-500">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 bg-indigo-50 rounded-xl">
                    <TrendingUp className="w-6 h-6 text-indigo-600" />
                  </div>
                  <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">إجمالي المبيعات</span>
                </div>
                <div className="text-3xl font-black text-slate-900">
                  {Object.values(calculations.clientStats).reduce<number>((acc, curr) => acc + (curr as ClientStats).totalReceivedValue, 0).toLocaleString()} <span className="text-sm font-normal text-slate-400">ر.ي</span>
                </div>
              </Card>

              <Card className="p-6 border-r-4 border-r-rose-500">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 bg-rose-50 rounded-xl">
                    <Wallet className="w-6 h-6 text-rose-600" />
                  </div>
                  <span className="text-xs font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded-lg">إجمالي الديون</span>
                </div>
                <div className="text-3xl font-black text-slate-900">
                  {Object.values(calculations.distStats).reduce<number>((acc, curr) => acc + ((curr as DistStats).deliveredValue - (curr as DistStats).totalDeposited), 0).toLocaleString()} <span className="text-sm font-normal text-slate-400">ر.ي</span>
                </div>
              </Card>

              <Card className="p-6 border-r-4 border-r-emerald-500">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 bg-emerald-50 rounded-xl">
                    <ArrowDownLeft className="w-6 h-6 text-emerald-600" />
                  </div>
                  <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">إجمالي التحصيل</span>
                </div>
                <div className="text-3xl font-black text-slate-900">
                  {Object.values(calculations.distStats).reduce<number>((acc, curr) => acc + (curr as DistStats).totalCollected, 0).toLocaleString()} <span className="text-sm font-normal text-slate-400">ر.ي</span>
                </div>
              </Card>

              <Card className="p-6 border-r-4 border-r-amber-500">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 bg-amber-50 rounded-xl">
                    <Package className="w-6 h-6 text-amber-600" />
                  </div>
                  <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">إجمالي الكروت</span>
                </div>
                <div className="text-3xl font-black text-slate-900">
                  {Object.values(calculations.catStats).reduce<number>((acc, curr) => acc + (curr as number), 0).toLocaleString()} <span className="text-sm font-normal text-slate-400">كرت</span>
                </div>
              </Card>
            </div>
          )}

          {activeTab === 'categories' && (
            <div className="space-y-6">
              <div className="flex justify-end">
                <button 
                  onClick={() => { setEditingItem(null); setShowModal('category'); }}
                  className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-xl font-bold hover:bg-slate-50 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> إضافة فئة
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {categories.map(cat => (
                  <Card key={cat.id} className="p-6 group hover:border-indigo-200 transition-all">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="text-xl font-bold text-slate-800">{cat.name}</h4>
                        <p className="text-indigo-600 font-black text-2xl mt-2">{cat.price} <span className="text-sm font-normal text-slate-400">ر.ي</span></p>
                      </div>
                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => { setEditingItem(cat); setShowModal('category'); }}
                          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setConfirmDelete({ type: 'category', id: cat.id, name: cat.name })}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'distributors' && (
            <div className="space-y-6">
              <div className="flex justify-end">
                <button 
                  onClick={() => setShowModal('distributor')}
                  className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-xl font-bold hover:bg-slate-50 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> إضافة موزع
                </button>
              </div>
              <div className="grid grid-cols-1 gap-6">
                {distributors.map(dist => {
                  const stats = calculations.distStats[dist.id];
                  const totalReceived = stats.deliveredValue;
                  const debtAtCustomers = (Object.values(calculations.clientDebtPerDistributor[dist.id] || {}) as number[]).reduce((a, b) => a + b, 0);
                  const debtWithDistributor = stats.totalCollected - stats.totalDeposited - stats.totalExpenses;
                  const totalRemaining = stats.deliveredValue - stats.totalDeposited - stats.totalExpenses;

                  return (
                    <Card key={dist.id} className="p-0 group">
                      <div className="p-6 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center shrink-0">
                            <Users className="w-6 h-6 text-slate-600" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-xl font-bold text-slate-800">{dist.name}</h4>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                  onClick={() => { setEditingItem(dist); setShowModal('distributor'); }}
                                  className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button 
                                  onClick={() => setConfirmDelete({ type: 'distributor', id: dist.id, name: dist.name })}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                                <button 
                                  onClick={() => setReportConfig({
                                    show: true,
                                    type: 'distributor',
                                    entityId: dist.id,
                                    entityName: dist.name,
                                    startDate: '',
                                    endDate: format(new Date(), 'yyyy-MM-dd'),
                                    reportType: 'full',
                                    distributorFilter: 'all',
                                    dateRangeType: 'until_today'
                                  })}
                                  className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                                  title="طباعة كشف حساب"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                            <p className="text-sm text-slate-500">معرف: {dist.id}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8 text-center flex-1">
                          <div className="bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                            <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-1 font-bold">إجمالي المستلم</p>
                            <p className="font-bold text-slate-800">{totalReceived.toLocaleString()}</p>
                          </div>
                          <div className="bg-rose-50/30 p-3 rounded-xl border border-rose-100/50">
                            <p className="text-[10px] uppercase tracking-wider text-rose-400 mb-1 font-bold">دين عند العملاء</p>
                            <p className="font-bold text-rose-600">{debtAtCustomers.toLocaleString()}</p>
                          </div>
                          <div className="bg-amber-50/30 p-3 rounded-xl border border-amber-100/50">
                            <p className="text-[10px] uppercase tracking-wider text-amber-400 mb-1 font-bold">ذمم بيد الموزع</p>
                            <p className="font-bold text-amber-600">{debtWithDistributor.toLocaleString()}</p>
                          </div>
                          <div className="bg-indigo-50/30 p-3 rounded-xl border border-indigo-100/50">
                            <p className="text-[10px] uppercase tracking-wider text-indigo-400 mb-1 font-bold">إجمالي المتبقى عليه</p>
                            <p className="font-bold text-indigo-600">{totalRemaining.toLocaleString()}</p>
                          </div>
                        </div>
                      </div>
                      <div className="p-6 bg-slate-50/50">
                        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
                          <h5 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                            <Package className="w-4 h-4" /> المخزون الحالي
                          </h5>
                          <div className="flex gap-4">
                            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm">
                              <span className="text-xs text-slate-400 font-bold">إجمالي المخزون:</span>
                              <span className="font-black text-indigo-600">{stats.totalStockValue.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm">
                              <span className="text-xs text-slate-400 font-bold">إجمالي الإيداع:</span>
                              <span className="font-black text-emerald-600">{stats.totalDeposited.toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                          {categories.map(cat => (
                            <div key={cat.id} className="bg-white p-3 rounded-xl border border-slate-200 text-center shadow-sm hover:border-indigo-200 transition-colors">
                              <p className="text-[10px] text-slate-400 mb-1 font-bold">فئة {cat.name}</p>
                              <p className="font-black text-slate-700">{stats.stock[cat.id] || 0}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'clients' && (
            <div className="space-y-6">
              <div className="flex justify-end">
                <button 
                  onClick={() => setShowModal('client')}
                  className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-xl font-bold hover:bg-slate-50 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> إضافة عميل
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {clients.map(client => {
                  const stats = calculations.clientStats[client.id];
                  const balance = stats.totalReceivedValue - stats.totalCollected;

                  return (
                    <Card key={client.id} className="p-6 group">
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                            <Users className="w-5 h-5 text-indigo-600" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-lg font-bold text-slate-800">{client.name}</h4>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                  onClick={() => { setEditingItem(client); setShowModal('client'); }}
                                  className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button 
                                  onClick={() => setConfirmDelete({ type: 'client', id: client.id, name: client.name })}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                                <button 
                                  onClick={() => setReportConfig({
                                    show: true,
                                    type: 'client',
                                    entityId: client.id,
                                    entityName: client.name,
                                    startDate: '',
                                    endDate: format(new Date(), 'yyyy-MM-dd'),
                                    reportType: 'full',
                                    distributorFilter: 'all',
                                    dateRangeType: 'until_today'
                                  })}
                                  className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                                  title="طباعة كشف حساب"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className={cn(
                          "px-3 py-1 rounded-lg text-sm font-bold",
                          balance > 0 ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"
                        )}>
                          {balance > 0 ? `عليه: ${balance.toLocaleString()}` : `له: ${Math.abs(balance).toLocaleString()}`}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <div className="text-center">
                          <p className="text-[10px] text-slate-400 mb-1">إجمالي عليه</p>
                          <p className="font-bold text-rose-600 text-sm">{stats.totalReceivedValue.toLocaleString()}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] text-slate-400 mb-1">إجمالي له</p>
                          <p className="font-bold text-emerald-600 text-sm">{stats.totalCollected.toLocaleString()}</p>
                        </div>
                        <div className="text-center border-r border-slate-200">
                          <p className="text-[10px] text-slate-400 mb-1">المتبقي</p>
                          <p className={cn("font-bold text-sm", balance > 0 ? "text-rose-600" : "text-emerald-600")}>
                            {Math.abs(balance).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">إجمالي الاستلام حسب الفئة</p>
                        <div className="grid grid-cols-3 gap-3">
                          {categories.map(cat => (
                            <div key={cat.id} className="bg-slate-50 p-2 rounded-lg border border-slate-100 text-center">
                              <p className="text-[10px] text-slate-500">{cat.name}</p>
                              <p className="font-bold text-slate-700">{stats.catReceived[cat.id] || 0}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="space-y-6">
              <Card className="overflow-x-auto">
                <table className="w-full text-right">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="p-4 font-bold text-slate-600">التاريخ</th>
                      <th className="p-4 font-bold text-slate-600">النوع</th>
                      <th className="p-4 font-bold text-slate-600">الطرف</th>
                      <th className="p-4 font-bold text-slate-600">التفاصيل</th>
                      <th className="p-4 font-bold text-slate-600">القيمة/الكمية</th>
                      <th className="p-4 font-bold text-slate-600">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {transactions.flatMap(tx => {
                      if (tx.items && tx.items.length > 1) {
                        return tx.items.map((item, idx) => ({
                          ...tx,
                          displayId: `${tx.id}-${idx}`,
                          items: [item]
                        }));
                      }
                      return [{ ...tx, displayId: tx.id }];
                    }).map(tx => {
                      const dist = distributors.find(d => d.id === tx.distributorId);
                      const client = clients.find(c => c.id === tx.clientId);
                      const typeLabel = tx.type === 'DELIVERY_TO_DISTRIBUTOR' ? 'تسليم لموزع' :
                                       tx.type === 'DISTRIBUTION_TO_CLIENT' ? 'توزيع لعميل' :
                                       tx.type === 'COLLECTION_FROM_CLIENT' ? 'تحصيل من عميل' : 'إيداع من موزع';
                      
                      return (
                        <tr key={tx.displayId} className="hover:bg-slate-50 transition-colors">
                          <td className="p-4 text-sm text-slate-500">{format(new Date(tx.date), 'yyyy/MM/dd HH:mm', { locale: ar })}</td>
                          <td className="p-4">
                            <span className={cn(
                              "px-3 py-1 rounded-full text-xs font-bold",
                              tx.type === 'DELIVERY_TO_DISTRIBUTOR' && "bg-blue-50 text-blue-600",
                              tx.type === 'DISTRIBUTION_TO_CLIENT' && "bg-purple-50 text-purple-600",
                              tx.type === 'COLLECTION_FROM_CLIENT' && "bg-emerald-50 text-emerald-600",
                              tx.type === 'DEPOSIT_FROM_DISTRIBUTOR' && "bg-amber-50 text-amber-600",
                            )}>
                              {typeLabel}
                            </span>
                          </td>
                          <td className="p-4 font-bold text-slate-700">
                            {dist?.name} {client ? ` ➔ ${client.name}` : ''}
                          </td>
                          <td className="p-4 text-sm text-slate-500">{tx.details}</td>
                          <td className="p-4">
                            {tx.amount ? (
                              <span className="font-black text-slate-800">{tx.amount.toLocaleString()} <small>ر.ي</small></span>
                            ) : (
                              <div className="flex flex-col">
                                {tx.items?.map((item, idx) => {
                                  const cat = categories.find(c => c.id === item.categoryId);
                                  return (
                                    <span key={idx} className="text-slate-700 font-bold">
                                      {cat?.name}: <span className="text-indigo-600">{item.quantity}</span> كرت
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => { 
                                  const originalTx = transactions.find(t => t.id === tx.id);
                                  setEditingItem(originalTx); 
                                  setShowModal('new_tx'); 
                                }}
                                className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                title="تعديل العملية"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => {
                                  const originalTx = transactions.find(t => t.id === tx.id);
                                  setConfirmDelete({ type: 'transaction', id: tx.id, name: `${typeLabel} - ${dist?.name}` });
                                }}
                                className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                title="حذف العملية"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            </div>
          )}

          {activeTab === 'reports' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <Card className="p-6 bg-gradient-to-br from-indigo-600 to-indigo-700 text-white border-none">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-white/20 rounded-xl">
                      <Wallet className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-indigo-100 text-sm">إجمالي مبيعات الفئات</p>
                      <h3 className="text-2xl font-black">
                        {(Object.values(calculations.catValueStats) as number[]).reduce((a, b) => a + b, 0).toLocaleString()}
                      </h3>
                    </div>
                  </div>
                </Card>
                <Card className="p-6 bg-white">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-emerald-50 rounded-xl">
                      <TrendingUp className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-slate-500 text-sm">إجمالي التحصيلات</p>
                      <h3 className="text-2xl font-black text-slate-800">
                        {(Object.values(calculations.distStats) as DistStats[]).reduce((a, b) => a + b.totalCollected, 0).toLocaleString()}
                      </h3>
                    </div>
                  </div>
                </Card>
                <Card className="p-6 bg-white">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-amber-50 rounded-xl">
                      <ArrowUpRight className="w-6 h-6 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-slate-500 text-sm">إجمالي الإيداعات</p>
                      <h3 className="text-2xl font-black text-slate-800">
                        {(Object.values(calculations.distStats) as DistStats[]).reduce((a, b) => a + b.totalDeposited, 0).toLocaleString()}
                      </h3>
                    </div>
                  </div>
                </Card>
                <Card className="p-6 bg-white">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-rose-50 rounded-xl">
                      <CreditCard className="w-6 h-6 text-rose-600" />
                    </div>
                    <div>
                      <p className="text-slate-500 text-sm">إجمالي ديون العملاء</p>
                      <h3 className="text-2xl font-black text-slate-800">
                        {(Object.values(calculations.clientStats) as ClientStats[]).reduce((a, b) => a + (b.totalReceivedValue - b.totalCollected), 0).toLocaleString()}
                      </h3>
                    </div>
                  </div>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Product Value Chart */}
                <Card className="p-6">
                  <h4 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <Package className="w-5 h-5 text-indigo-600" />
                    قيمة المبيعات حسب الفئة
                  </h4>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categories.map(cat => ({
                            name: cat.name,
                            value: calculations.catValueStats[cat.id] || 0
                          })).filter(d => d.value > 0)}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                          label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        >
                          {categories.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b'][index % 5]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          formatter={(value: number) => [`${value.toLocaleString()} ر.ي`, 'القيمة']}
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                {/* Distributor Efficiency */}
                <Card className="p-6">
                  <h4 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-emerald-600" />
                    كفاءة التوريد (التحصيل vs الإيداع)
                  </h4>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={distributors.map(d => ({
                          name: d.name,
                          collected: calculations.distStats[d.id].totalCollected,
                          deposited: calculations.distStats[d.id].totalDeposited + calculations.distStats[d.id].totalExpenses
                        }))}
                        margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <Tooltip 
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        />
                        <Bar dataKey="collected" name="تم تحصيله" fill="#10b981" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="deposited" name="تم إيداعه" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </div>

              {/* Debt Matrix: Client Debt per Distributor */}
              <Card className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h4 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <Users className="w-5 h-5 text-rose-600" />
                    تفاصيل ديون العملاء لكل موزع
                  </h4>
                  <span className="text-xs bg-slate-100 text-slate-500 px-3 py-1 rounded-full">تقرير تفصيلي</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-right border-collapse">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="p-4 font-bold text-slate-700 border border-slate-100">العميل / الموزع</th>
                        {distributors.map(d => (
                          <th key={d.id} className="p-4 font-bold text-slate-700 border border-slate-100">{d.name}</th>
                        ))}
                        <th className="p-4 font-bold text-indigo-700 border border-slate-100 bg-indigo-50/50">إجمالي دين العميل</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {clients.map(client => {
                        let totalClientDebt = 0;
                        return (
                          <tr key={client.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="p-4 font-bold text-slate-800 border border-slate-100">{client.name}</td>
                            {distributors.map(dist => {
                              const debt = calculations.clientDebtPerDistributor[dist.id]?.[client.id] || 0;
                              totalClientDebt += debt;
                              return (
                                <td key={dist.id} className={cn(
                                  "p-4 border border-slate-100",
                                  debt > 0 ? "text-rose-600 font-medium" : "text-slate-400"
                                )}>
                                  {debt > 0 ? debt.toLocaleString() : '-'}
                                </td>
                              );
                            })}
                            <td className="p-4 font-black text-indigo-600 border border-slate-100 bg-indigo-50/30">
                              {totalClientDebt.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 font-bold">
                        <td className="p-4 text-slate-700 border border-slate-100">إجمالي ديون الموزع</td>
                        {distributors.map(dist => {
                          const totalDistDebt = (Object.values(calculations.clientDebtPerDistributor[dist.id] || {}) as number[]).reduce((a, b) => a + b, 0);
                          return (
                            <td key={dist.id} className="p-4 text-rose-600 border border-slate-100">
                              {totalDistDebt.toLocaleString()}
                            </td>
                          );
                        })}
                        <td className="p-4 text-indigo-700 border border-slate-100 bg-indigo-50/50">
                          {(Object.values(calculations.clientStats) as ClientStats[]).reduce((a, b) => a + (b.totalReceivedValue - b.totalCollected), 0).toLocaleString()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>

              {/* Distributor Performance Table */}
              <Card className="p-6">
                <h4 className="text-lg font-bold text-slate-800 mb-6">أداء الموزعين العام</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-right">
                    <thead>
                      <tr className="text-slate-400 text-sm border-b border-slate-100">
                        <th className="pb-4 font-normal">الموزع</th>
                        <th className="pb-4 font-normal">قيمة المستلم</th>
                        <th className="pb-4 font-normal">إجمالي التحصيل</th>
                        <th className="pb-4 font-normal">إجمالي الإيداع</th>
                        <th className="pb-4 font-normal">الصافي (عند الموزع)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {distributors.map(dist => {
                        const s = calculations.distStats[dist.id];
                        const netAtDistributor = s.totalCollected - s.totalDeposited;
                        return (
                          <tr key={dist.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="py-4 font-bold text-slate-700">{dist.name}</td>
                            <td className="py-4 text-slate-600">{s.deliveredValue.toLocaleString()}</td>
                            <td className="py-4 text-slate-600">{s.totalCollected.toLocaleString()}</td>
                            <td className="py-4 text-slate-600">{s.totalDeposited.toLocaleString()}</td>
                            <td className={cn(
                              "py-4 font-black",
                              netAtDistributor > 0 ? "text-amber-600" : "text-emerald-600"
                            )}>
                              {netAtDistributor.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      {showModal === 'category' && (
        <Modal 
          title={editingItem ? 'تعديل فئة' : 'إضافة فئة جديدة'} 
          onClose={() => setShowModal(null)}
        >
          <form onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const data = {
              name: formData.get('name') as string,
              price: Number(formData.get('price')),
            };
            if (editingItem) {
              updateCategory({ ...editingItem, ...data });
            } else {
              addCategory(data);
            }
          }} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">اسم الفئة</label>
              <input 
                name="name" 
                defaultValue={editingItem?.name}
                required 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                placeholder="مثال: 100"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">السعر (ر.ي)</label>
              <input 
                name="price" 
                type="number"
                defaultValue={editingItem?.price}
                required 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                placeholder="0.00"
              />
            </div>
            <button className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 mt-4">
              {editingItem ? 'تحديث الفئة' : 'حفظ الفئة'}
            </button>
          </form>
        </Modal>
      )}

       {showModal === 'distributor' && (
        <Modal 
          title={editingItem ? 'تعديل موزع' : 'إضافة موزع جديد'} 
          onClose={() => { setShowModal(null); setEditingItem(null); }}
        >
          <form onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const name = formData.get('name') as string;
            if (editingItem) {
              updateDistributor({ ...editingItem, name });
            } else {
              addDistributor(name);
            }
          }} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">اسم الموزع</label>
              <input 
                name="name" 
                defaultValue={editingItem?.name}
                required 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                placeholder="أدخل الاسم الكامل"
              />
            </div>
            <button className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 mt-4">
              {editingItem ? 'تحديث الموزع' : 'حفظ الموزع'}
            </button>
          </form>
        </Modal>
      )}

      {showModal === 'client' && (
        <Modal 
          title={editingItem ? 'تعديل عميل' : 'إضافة عميل جديد'} 
          onClose={() => { setShowModal(null); setEditingItem(null); }}
        >
          <form onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const name = formData.get('name') as string;
            if (editingItem) {
              updateClient({ ...editingItem, name });
            } else {
              addClient(name);
            }
          }} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">اسم العميل (المحل)</label>
              <input 
                name="name" 
                defaultValue={editingItem?.name}
                required 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                placeholder="أدخل اسم المحل أو العميل"
              />
            </div>
            <button className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 mt-4">
              {editingItem ? 'تحديث العميل' : 'حفظ العميل'}
            </button>
          </form>
        </Modal>
      )}

      {showModal === 'new_tx' && (
        <Modal 
          title={editingItem ? 'تعديل عملية' : 'تسجيل عملية جديدة'} 
          onClose={() => { setShowModal(null); setEditingItem(null); }}
        >
          <TransactionForm 
            categories={categories}
            distributors={distributors}
            clients={clients}
            distStats={calculations.distStats}
            initialData={editingItem}
            onSubmit={(tx) => {
              if (editingItem) {
                updateTransaction({ ...editingItem, ...tx });
              } else {
                addTransaction(tx);
              }
            }}
          />
        </Modal>
      )}

      {reportConfig.show && (
        <Modal 
          title={`إعداد كشف حساب: ${reportConfig.entityName}`}
          onClose={() => setReportConfig(prev => ({ ...prev, show: false }))}
        >
          <div className="space-y-6">
            <div className="space-y-4">
              {/* Date Range Selection */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">الفترة الزمنية</label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl mb-4">
                  <button
                    onClick={() => setReportConfig(prev => ({ ...prev, dateRangeType: 'until_today' }))}
                    className={cn(
                      "py-2 text-sm font-bold rounded-lg transition-all",
                      reportConfig.dateRangeType === 'until_today' 
                        ? "bg-white text-indigo-600 shadow-sm" 
                        : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    حتى اليوم
                  </button>
                  <button
                    onClick={() => setReportConfig(prev => ({ ...prev, dateRangeType: 'custom' }))}
                    className={cn(
                      "py-2 text-sm font-bold rounded-lg transition-all",
                      reportConfig.dateRangeType === 'custom' 
                        ? "bg-white text-indigo-600 shadow-sm" 
                        : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    فترة مخصصة
                  </button>
                </div>

                {reportConfig.dateRangeType === 'custom' && (
                  <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">من تاريخ</label>
                      <div className="relative">
                        <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input 
                          type="date"
                          value={reportConfig.startDate}
                          onChange={e => setReportConfig(prev => ({ ...prev, startDate: e.target.value }))}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">إلى تاريخ</label>
                      <div className="relative">
                        <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input 
                          type="date"
                          value={reportConfig.endDate}
                          onChange={e => setReportConfig(prev => ({ ...prev, endDate: e.target.value }))}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Distributor Filter for Client Reports */}
              {reportConfig.type === 'client' && (
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">اختيار الموزع</label>
                  <select 
                    value={reportConfig.distributorFilter}
                    onChange={e => setReportConfig(prev => ({ ...prev, distributorFilter: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  >
                    <option value="all">كل الموزعين</option>
                    {distributors.map(dist => (
                      <option key={dist.id} value={dist.id}>{dist.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">نوع التقرير</label>
                <select 
                  value={reportConfig.reportType}
                  onChange={e => setReportConfig(prev => ({ ...prev, reportType: e.target.value as 'full' }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                >
                  <option value="full">كشف حساب كامل</option>
                </select>
              </div>
            </div>

            <button 
              onClick={() => generatePDF()}
              className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
            >
              <FileText className="w-5 h-5" /> إنشاء PDF
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-8 h-8 text-rose-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">تأكيد الحذف</h3>
              <p className="text-slate-500 mb-6">
                هل أنت متأكد من حذف <span className="font-bold text-slate-700">"{confirmDelete.name}"</span>؟ لا يمكن التراجع عن هذا الإجراء.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setConfirmDelete(null)}
                  className="flex-1 bg-slate-100 text-slate-700 font-bold py-3 rounded-xl hover:bg-slate-200 transition-all"
                >
                  إلغاء
                </button>
                <button 
                  onClick={() => {
                    if (confirmDelete.type === 'category') deleteCategory(confirmDelete.id);
                    if (confirmDelete.type === 'distributor') deleteDistributor(confirmDelete.id);
                    if (confirmDelete.type === 'client') deleteClient(confirmDelete.id);
                    if (confirmDelete.type === 'transaction') deleteTransaction(confirmDelete.id);
                  }}
                  className="flex-1 bg-rose-600 text-white font-bold py-3 rounded-xl hover:bg-rose-700 transition-all shadow-lg shadow-rose-200"
                >
                  حذف
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TransactionForm({ 
  categories, 
  distributors, 
  clients, 
  distStats,
  initialData,
  onSubmit 
}: { 
  categories: Category[], 
  distributors: Distributor[], 
  clients: Client[],
  distStats: Record<string, DistStats>,
  initialData?: Transaction,
  onSubmit: (tx: Omit<Transaction, 'id'>) => void
}) {
  const [type, setType] = useState<TransactionType>(initialData?.type || 'DELIVERY_TO_DISTRIBUTOR');
  const [selectedItems, setSelectedItems] = useState<TransactionItem[]>(initialData?.items || []);
  const [distributorId, setDistributorId] = useState(initialData?.distributorId || '');
  const [clientId, setClientId] = useState(initialData?.clientId || '');
  const [amount, setAmount] = useState<number>(initialData?.amount || 0);
  const [details, setDetails] = useState(initialData?.details || '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialData) {
      setType(initialData.type);
      setSelectedItems(initialData.items || []);
      setDistributorId(initialData.distributorId || '');
      setClientId(initialData.clientId || '');
      setAmount(initialData.amount || 0);
      setDetails(initialData.details || '');
    }
  }, [initialData]);

  const handleAddItem = (catId: string) => {
    const cat = categories.find(c => c.id === catId);
    if (!cat) return;
    if (selectedItems.find(i => i.categoryId === catId)) return;
    setSelectedItems([...selectedItems, { categoryId: catId, quantity: 1, price: cat.price }]);
  };

  const updateItemQty = (catId: string, qty: number) => {
    setSelectedItems(selectedItems.map(i => i.categoryId === catId ? { ...i, quantity: qty } : i));
  };

  const removeItem = (catId: string) => {
    setSelectedItems(selectedItems.filter(i => i.categoryId !== catId));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Stock validation for distribution to client
    if (type === 'DISTRIBUTION_TO_CLIENT' && distributorId) {
      const stats = distStats[distributorId];
      for (const item of selectedItems) {
        const available = stats.stock[item.categoryId] || 0;
        if (item.quantity > available) {
          const cat = categories.find(c => c.id === item.categoryId);
          setError(`المخزون غير كافٍ للفئة ${cat?.name}. المتوفر: ${available}`);
          return;
        }
      }
    }

    if (selectedItems.length === 0 && (type === 'DELIVERY_TO_DISTRIBUTOR' || type === 'DISTRIBUTION_TO_CLIENT')) {
      setError('يرجى اختيار فئة واحدة على الأقل');
      return;
    }

    onSubmit({
      type,
      distributorId,
      clientId: (type === 'DISTRIBUTION_TO_CLIENT' || type === 'COLLECTION_FROM_CLIENT') ? clientId : undefined,
      items: (type === 'DELIVERY_TO_DISTRIBUTOR' || type === 'DISTRIBUTION_TO_CLIENT') ? selectedItems : undefined,
      amount: (type === 'COLLECTION_FROM_CLIENT' || type === 'DEPOSIT_FROM_DISTRIBUTOR' || type === 'OTHER_EXPENSE') ? amount : undefined,
      date: initialData?.date || new Date().toISOString(),
      details
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-600 p-4 rounded-xl text-sm font-bold flex items-center gap-2">
          <X className="w-4 h-4" />
          {error}
        </div>
      )}
      <div className="space-y-6">
        {/* Card Operations */}
        <div className="space-y-3">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider pr-1">عمليات الكروت</label>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: 'DELIVERY_TO_DISTRIBUTOR', label: 'تسليم لموزع', icon: '📦' },
              { id: 'DISTRIBUTION_TO_CLIENT', label: 'توزيع لعميل', icon: '🏪' },
            ].map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setType(t.id as TransactionType)}
                className={cn(
                  "flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all gap-2 h-24",
                  type === t.id 
                    ? "bg-indigo-50 border-indigo-600 text-indigo-700 shadow-md scale-[1.02]" 
                    : "bg-white border-slate-100 text-slate-500 hover:border-slate-200"
                )}
              >
                <span className="text-3xl">{t.icon}</span>
                <span className="text-xs font-bold">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Financial Operations */}
        <div className="space-y-3">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider pr-1">العمليات المالية</label>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: 'COLLECTION_FROM_CLIENT', label: 'تحصيل', icon: '💰' },
              { id: 'DEPOSIT_FROM_DISTRIBUTOR', label: 'إيداع', icon: '🏦' },
            ].map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setType(t.id as TransactionType)}
                className={cn(
                  "flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all gap-2 h-24",
                  type === t.id 
                    ? "bg-indigo-50 border-indigo-600 text-indigo-700 shadow-md scale-[1.02]" 
                    : "bg-white border-slate-100 text-slate-500 hover:border-slate-200"
                )}
              >
                <span className="text-3xl">{t.icon}</span>
                <span className="text-xs font-bold">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Other Operations */}
        <div className="space-y-3">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider pr-1">عمليات أخرى</label>
          <div className="grid grid-cols-1">
            {[
              { id: 'OTHER_EXPENSE', label: 'مصروفات اخرى', icon: '🧾' },
            ].map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setType(t.id as TransactionType)}
                className={cn(
                  "flex items-center justify-center p-4 rounded-2xl border-2 transition-all gap-4 h-20",
                  type === t.id 
                    ? "bg-indigo-50 border-indigo-600 text-indigo-700 shadow-md scale-[1.02]" 
                    : "bg-white border-slate-100 text-slate-500 hover:border-slate-200"
                )}
              >
                <span className="text-3xl">{t.icon}</span>
                <span className="text-sm font-bold">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">الموزع</label>
          <select 
            required 
            value={distributorId}
            onChange={e => setDistributorId(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none"
          >
            <option value="">اختر الموزع</option>
            {distributors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        {(type === 'DISTRIBUTION_TO_CLIENT' || type === 'COLLECTION_FROM_CLIENT') && (
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">العميل</label>
            <select 
              required 
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none"
            >
              <option value="">اختر العميل</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        {(type === 'DELIVERY_TO_DISTRIBUTOR' || type === 'DISTRIBUTION_TO_CLIENT') ? (
          <div className="space-y-4">
            <label className="block text-sm font-bold text-slate-700">الفئات والكميات</label>
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleAddItem(cat.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-bold border transition-all",
                    selectedItems.find(i => i.categoryId === cat.id)
                      ? "bg-indigo-600 border-indigo-600 text-white"
                      : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300"
                  )}
                >
                  {cat.name}
                </button>
              ))}
            </div>
            
            <div className="space-y-2">
              {selectedItems.map(item => {
                const cat = categories.find(c => c.id === item.categoryId);
                return (
                  <div key={item.categoryId} className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <span className="font-bold text-slate-700">{cat?.name}</span>
                    <div className="flex items-center gap-3">
                      <input 
                        type="number" 
                        min="1"
                        value={item.quantity}
                        onChange={e => updateItemQty(item.categoryId, Number(e.target.value))}
                        className="w-20 bg-white border border-slate-200 rounded-lg px-2 py-1 text-center font-bold"
                      />
                      <button 
                        type="button"
                        onClick={() => removeItem(item.categoryId)}
                        className="text-rose-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">المبلغ (ر.ي)</label>
            <input 
              type="number" 
              required 
              value={amount}
              onChange={e => setAmount(Number(e.target.value))}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none"
              placeholder="0.00"
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">ملاحظات إضافية</label>
          <textarea 
            value={details}
            onChange={e => setDetails(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none min-h-[80px]"
            placeholder="أدخل أي تفاصيل أخرى هنا..."
          />
        </div>
      </div>

      <button className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200">
        تأكيد العملية
      </button>
    </form>
  );
}
