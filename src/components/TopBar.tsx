import React from 'react';
import { NovaMark } from './NovaMark';

interface TopBarProps {
  title?: string;
  isHome?: boolean;
  onBack?: () => void;
  onOpenSimulateModal?: () => void;
  onOpenProfile?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  title,
  isHome = false,
  onBack,
  onOpenSimulateModal,
  onOpenProfile,
}) => {
  return (
    <header className="sticky top-0 w-full z-50 pt-safe bg-white/95 backdrop-blur-md border-b border-[#E5E8EB]">
      <div className="h-14 px-3 flex items-center justify-between">
        {isHome ? (
          <div className="flex items-center gap-1.5" aria-label="NOVA">
            <NovaMark size={32} className="shrink-0" />
            <span className="text-[17px] font-bold tracking-tight text-[#0F6B6D]">NOVA</span>
          </div>
        ) : (
          <button
            aria-label="返回"
            onClick={onBack}
            className="w-11 h-11 flex items-center justify-center text-[#1F2329] rounded-full hover:bg-[#F0F2F5] active:scale-95 transition-all"
          >
            <span className="material-symbols-outlined text-[22px]">arrow_back</span>
          </button>
        )}

        {!isHome && (
          <h1 className="text-[17px] font-semibold text-[#1F2329] tracking-tight text-center truncate px-2 max-w-[190px]">
            {title}
          </h1>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenSimulateModal}
            className="px-2.5 py-0.5 rounded-full bg-[#F0F2F5] hover:bg-[#E5E8EB] active:scale-95 text-[#5A616B] text-[12px] font-medium transition-all cursor-pointer flex items-center gap-1"
            title="点击切换模拟数据或事件"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#8F959E]"></span>
            <span>模拟数据</span>
          </button>

          <button
            onClick={onOpenProfile}
            className="w-8 h-8 rounded-full bg-[#E6F2F2] border border-[#0F6B6D]/20 flex items-center justify-center text-[#0F6B6D] hover:bg-[#0F6B6D] hover:text-white transition-all cursor-pointer active:scale-95"
            title="个人设置"
          >
            <span className="material-symbols-outlined text-[18px]">person</span>
          </button>
        </div>
      </div>
    </header>
  );
};
