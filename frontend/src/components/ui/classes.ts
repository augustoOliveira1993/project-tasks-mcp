export const buttonBase = 'inline-flex items-center justify-center gap-2 rounded-lg border text-[10px] font-bold transition';
const secondaryTone = 'border-[#e1e5ed] bg-white text-[#5d697b] hover:border-[#ccd2df] hover:bg-[#fafbff]';

export const buttonSecondary = `${buttonBase} min-h-[35px] px-3 ${secondaryTone}`;
export const buttonSecondarySmall = `${buttonBase} min-h-[29px] px-2.5 ${secondaryTone}`;
export const buttonDanger = `${buttonBase} min-h-[35px] px-3 border-[#b3404a] bg-[#b3404a] text-white enabled:hover:border-[#922f38] enabled:hover:bg-[#922f38] disabled:cursor-not-allowed disabled:opacity-55`;

export const errorBox = 'rounded-[8px] border border-[#f3d3d5] bg-[#fff6f6] px-[13px] py-[11px] text-[#a6454d]';

export const buttonPrimary = `${buttonBase} min-h-[35px] px-3 border-transparent bg-accent text-white shadow-[0_3px_8px_#5364dd2a] hover:bg-accent-dark`;
export const buttonGhost = `${buttonBase} min-h-[35px] px-3 border-transparent bg-transparent text-[#758093]`;

const noticeBox = 'rounded-[8px] border px-[13px] py-[11px] text-[10px]';
export const notice = {
  info: `${noticeBox} border-[#dfe4f3] bg-[#f7f8fc] text-[#566377]`,
  success: `${noticeBox} border-[#cce8d8] bg-[#f4fbf7] text-[#387152]`,
  error: `${noticeBox} border-[#f3d3d5] bg-[#fff6f6] text-[#a6454d]`
};

export const eyebrow = 'mb-1.5 font-display text-[9px] leading-[normal] font-bold tracking-[.11em] text-[#7180d8]';
export const textButton = 'px-0 py-1 text-[11px] font-semibold text-[#5c6bd5] hover:text-[#3748bf]';
