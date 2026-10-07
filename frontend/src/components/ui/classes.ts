const buttonBase = 'inline-flex items-center justify-center gap-2 rounded-lg border text-[10px] font-bold transition';
const secondaryTone = 'border-[#e1e5ed] bg-white text-[#5d697b] hover:border-[#ccd2df] hover:bg-[#fafbff]';

export const buttonSecondary = `${buttonBase} min-h-[35px] px-3 ${secondaryTone}`;
export const buttonSecondarySmall = `${buttonBase} min-h-[29px] px-2.5 ${secondaryTone}`;
export const buttonDanger = `${buttonBase} min-h-[35px] px-3 border-[#b3404a] bg-[#b3404a] text-white enabled:hover:border-[#922f38] enabled:hover:bg-[#922f38] disabled:cursor-not-allowed disabled:opacity-55`;

export const errorBox = 'rounded-[8px] border border-[#f3d3d5] bg-[#fff6f6] px-[13px] py-[11px] text-[#a6454d]';
