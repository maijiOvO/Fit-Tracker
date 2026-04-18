import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Language, User, WeightEntry, Measurement } from '../../types';
import { db } from '../../services/db';
import { supabase } from '../../services/supabase';

interface UserSettingsContextType {
  // Language
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLanguage: () => void;
  
  // Unit
  unit: 'kg' | 'lbs';
  setUnit: (unit: 'kg' | 'lbs') => void;
  
  // Weight Entries
  weightEntries: WeightEntry[];
  addWeightEntry: (entry: WeightEntry) => Promise<void>;
  deleteWeightEntry: (id: string) => Promise<void>;
  refreshWeightEntries: () => Promise<void>;
  
  // Measurements
  measurements: Measurement[];
  addMeasurement: (measurement: Measurement) => Promise<void>;
  updateMeasurement: (measurement: Measurement) => Promise<void>;
  deleteMeasurement: (id: string) => Promise<void>;
  refreshMeasurements: () => Promise<void>;
}

const UserSettingsContext = createContext<UserSettingsContextType | undefined>(undefined);

export const UserSettingsProvider: React.FC<{ children: ReactNode; userId?: string }> = ({ 
  children, 
  userId 
}) => {
  // Language
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem('fitlog_lang');
    return saved === Language.EN ? Language.EN : Language.CN;
  });
  
  // Unit
  const [unit, setUnitState] = useState<'kg' | 'lbs'>(() => {
    const saved = localStorage.getItem('fitlog_unit');
    return (saved as 'kg' | 'lbs') || 'kg';
  });
  
  // Weight Entries
  const [weightEntries, setWeightEntries] = useState<WeightEntry[]>([]);
  
  // Measurements
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  useEffect(() => {
    loadData();
  }, [userId]);

  const loadData = async () => {
    try {
      // Load weight entries
      const localWeights = await db.getAll('weight_entries');
      setWeightEntries(localWeights);
      
      if (userId && userId !== 'u_guest') {
        const { data: cloudWeights } = await supabase
          .from('weight_entries')
          .select('*')
          .eq('user_id', userId);
          
        if (cloudWeights && cloudWeights.length > 0) {
          const merged = mergeWeightEntries(localWeights, cloudWeights);
          setWeightEntries(merged);
          for (const w of merged) {
            await db.upsert('weight_entries', w);
          }
        }
      }
      
      // Load measurements
      const localMeasurements = await db.getAll('measurements');
      setMeasurements(localMeasurements);
      
      if (userId && userId !== 'u_guest') {
        const { data: cloudMeasurements } = await supabase
          .from('measurements')
          .select('*')
          .eq('user_id', userId);
          
        if (cloudMeasurements && cloudMeasurements.length > 0) {
          const merged = mergeMeasurements(localMeasurements, cloudMeasurements);
          setMeasurements(merged);
          for (const m of merged) {
            await db.upsert('measurements', m);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load user data:', error);
    }
  };

  // Language handlers
  const setLang = (newLang: Language) => {
    setLangState(newLang);
    localStorage.setItem('fitlog_lang', newLang);
  };

  const toggleLanguage = () => {
    const newLang = lang === Language.CN ? Language.EN : Language.CN;
    setLang(newLang);
  };

  // Unit handlers
  const setUnit = (newUnit: 'kg' | 'lbs') => {
    setUnitState(newUnit);
    localStorage.setItem('fitlog_unit', newUnit);
  };

  // Weight Entry handlers
  const addWeightEntry = async (entry: WeightEntry) => {
    await db.upsert('weight_entries', entry);
    setWeightEntries(prev => [...prev, entry]);
    
    if (userId && userId !== 'u_guest') {
      await supabase.from('weight_entries').upsert({
        id: entry.id,
        user_id: userId,
        weight: entry.weight,
        date: entry.date,
        created_at: entry.createdAt,
      });
    }
  };

  const deleteWeightEntry = async (id: string) => {
    await db.delete('weight_entries', id);
    setWeightEntries(prev => prev.filter(w => w.id !== id));
    
    if (userId && userId !== 'u_guest') {
      await supabase.from('weight_entries').delete().eq('id', id);
    }
  };

  // Measurement handlers
  const addMeasurement = async (measurement: Measurement) => {
    await db.upsert('measurements', measurement);
    setMeasurements(prev => [...prev, measurement]);
    
    if (userId && userId !== 'u_guest') {
      await supabase.from('measurements').upsert({
        id: measurement.id,
        user_id: userId,
        name: measurement.name,
        value: measurement.value,
        unit: measurement.unit,
        date: measurement.date,
        created_at: measurement.createdAt,
      });
    }
  };

  const updateMeasurement = async (measurement: Measurement) => {
    await db.upsert('measurements', measurement);
    setMeasurements(prev => prev.map(m => m.id === measurement.id ? measurement : m));
    
    if (userId && userId !== 'u_guest') {
      await supabase.from('measurements').upsert({
        id: measurement.id,
        user_id: userId,
        name: measurement.name,
        value: measurement.value,
        unit: measurement.unit,
        date: measurement.date,
        created_at: measurement.createdAt,
      });
    }
  };

  const deleteMeasurement = async (id: string) => {
    await db.delete('measurements', id);
    setMeasurements(prev => prev.filter(m => m.id !== id));
    
    if (userId && userId !== 'u_guest') {
      await supabase.from('measurements').delete().eq('id', id);
    }
  };

  return (
    <UserSettingsContext.Provider value={{
      lang,
      setLang,
      toggleLanguage,
      unit,
      setUnit,
      weightEntries,
      addWeightEntry,
      deleteWeightEntry,
      refreshWeightEntries: loadData,
      measurements,
      addMeasurement,
      updateMeasurement,
      deleteMeasurement,
      refreshMeasurements: loadData,
    }}>
      {children}
    </UserSettingsContext.Provider>
  );
};

export const useUserSettingsContext = (): UserSettingsContextType => {
  const context = useContext(UserSettingsContext);
  if (!context) {
    throw new Error('useUserSettingsContext must be used within UserSettingsProvider');
  }
  return context;
};

// Helper functions
function mergeWeightEntries(local: WeightEntry[], cloud: any[]): WeightEntry[] {
  const map = new Map(local.map(w => [w.id, w]));
  for (const cw of cloud) {
    map.set(cw.id, cw as WeightEntry);
  }
  return Array.from(map.values()).sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

function mergeMeasurements(local: Measurement[], cloud: any[]): Measurement[] {
  const map = new Map(local.map(m => [m.id, m]));
  for (const cm of cloud) {
    map.set(cm.id, cm as Measurement);
  }
  return Array.from(map.values()).sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export default UserSettingsContext;
