import React from 'react';
import { ScreenId } from '../types';

interface BottomNavProps {
  currentScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ currentScreen, onNavigate }) => {
  return (
    <nav className="sticky bottom-0 w-full z-50 pb-safe bg-white border-t border-[#E5E8EB]">
      <div className="h-14 px-2 grid grid-cols-5 items-center">
        {/* Tab 1: 首页 */}
        <button
          onClick={() => onNavigate('home')}
          className={`flex flex-col items-center justify-center gap-0.5 h-full transition-colors cursor-pointer ${
            currentScreen === 'home'
              ? 'text-[#0F6B6D] font-bold'
              : 'text-[#646A73] hover:text-[#1F2329]'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">dashboard</span>
          <span className="text-[11px]">首页</span>
        </button>

        {/* Tab 2: 目标 */}
        <button
          onClick={() => onNavigate('goals_list')}
          className={`flex flex-col items-center justify-center gap-0.5 h-full transition-colors cursor-pointer ${
            currentScreen === 'goals_list'
              ? 'text-[#0F6B6D] font-bold'
              : 'text-[#646A73] hover:text-[#1F2329]'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">track_changes</span>
          <span className="text-[11px]">目标</span>
        </button>

        {/* Tab 3: NOVA Center Button */}
        <button
          onClick={() => onNavigate('workspace')}
          className={`flex flex-col items-center justify-center h-full transition-transform active:scale-95 cursor-pointer group ${currentScreen === 'workspace' ? 'font-bold' : ''}`}
          title="新建目标 / NOVA 智能对话"
        >
          <div className="w-9 h-9 rounded-full bg-[#0F6B6D] group-hover:bg-[#084C4E] text-white flex items-center justify-center shadow-sm transition-colors">
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.4"
              viewBox="0 0 24 24"
            >
              <path d="M5 19V5l7 14V5l7 14V5"></path>
            </svg>
          </div>
          <span className="text-[10px] text-[#0F6B6D] font-semibold mt-0.5">NOVA</span>
        </button>

        {/* Tab 4: 动态 */}
        <button
          onClick={() => onNavigate('activity')}
          className={`flex flex-col items-center justify-center gap-0.5 h-full transition-colors cursor-pointer ${
            currentScreen === 'activity'
              ? 'text-[#0F6B6D] font-bold'
              : 'text-[#646A73] hover:text-[#1F2329]'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">timeline</span>
          <span className="text-[11px]">动态</span>
        </button>

        {/* Tab 5: 我的 */}
        <button
          onClick={() => onNavigate('profile')}
          className={`flex flex-col items-center justify-center gap-0.5 h-full transition-colors cursor-pointer ${
            currentScreen === 'profile'
              ? 'text-[#0F6B6D] font-bold'
              : 'text-[#646A73] hover:text-[#1F2329]'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">account_circle</span>
          <span className="text-[11px]">我的</span>
        </button>
      </div>
    </nav>
  );
};
