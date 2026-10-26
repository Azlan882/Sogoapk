import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import sogoLogo from '../assets/sogo-mark.svg';

export interface SplashProps {
  onFinish: () => void;
}

export const Splash: React.FC<SplashProps> = ({ onFinish }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onFinish();
    }, 1800);
    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <div className="fixed inset-0 z-50 bg-[#0B0F1A] flex flex-col items-center justify-center text-white px-4">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="flex flex-col items-center gap-4 text-center"
      >
        <img
          src={sogoLogo}
          alt="SogoSocial"
          className="w-24 h-24 object-contain drop-shadow-2xl"
        />
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
          SogoSocial
        </h1>
        <p className="text-sm text-slate-400 font-medium">
          Visual stories & creator connections
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.5 }}
        className="absolute bottom-10 flex flex-col items-center gap-2"
      >
        <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-slate-500">Launching workspace...</span>
      </motion.div>
    </div>
  );
};
