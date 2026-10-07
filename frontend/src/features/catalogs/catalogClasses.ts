import { notice } from '../../components/ui/classes';

/** Fragmentos de estilo compartilhados pelas telas de cadastros (/catalogs/*). Cada valor é uma string literal completa para o Tailwind gerar as classes. */

const buttonCore = 'inline-flex items-center justify-center gap-2 rounded-lg border font-bold transition';
export const secondaryTone = 'border-[#e1e5ed] bg-white text-[#5d697b] hover:border-[#ccd2df] hover:bg-[#fafbff]';
export const primaryTone = 'border-transparent bg-accent text-white shadow-[0_3px_8px_#5364dd2a] hover:bg-accent-dark';
/** Botões compactos da tabela de projetos (Usar / Ver / Editar). */
export const buttonPrimaryCompact = `${buttonCore} min-h-[28px] px-2 text-[9px] ${primaryTone}`;
export const buttonSecondaryCompact = `${buttonCore} min-h-[28px] px-2 text-[9px] ${secondaryTone}`;
/** Texto vermelho (Arquivar / Remover): a cor do tema vence a de `textButton` e o hover só pinta o fundo. */
export const dangerTextButton = 'px-0 py-1 text-[11px] font-semibold whitespace-nowrap text-tone-red enabled:hover:bg-tone-red-bg';
export const dangerTextCompact = 'py-[5px] pr-0 pl-1 text-[9px] font-semibold whitespace-nowrap text-tone-red enabled:hover:bg-tone-red-bg';
export const textButtonNowrap = 'px-0 py-1 text-[11px] font-semibold whitespace-nowrap text-[#5c6bd5] hover:text-[#3748bf]';

export const catalogsHeading = 'flex items-end justify-between gap-5 mb-3 max-[760px]:flex-col max-[760px]:items-stretch';
export const catalogsTitle = 'mb-1.5 font-display text-[length:clamp(21px,2vw,27px)] leading-[normal] font-extrabold tracking-[-.045em] max-[760px]:text-[21px]';
export const catalogsDescription = 'text-[12px] text-muted-strong';

export const screen = 'grid min-w-0 gap-[13px]';
export const screenHeading = 'flex items-start justify-between gap-3 max-[760px]:flex-col max-[760px]:items-stretch';
export const screenTitle = 'mb-1 font-display text-[15px] leading-[normal] font-bold text-[#344156]';
export const screenDescription = 'text-[10px] text-muted-strong';
export const screenAction = 'max-[760px]:w-full';

export const tableCard = 'min-w-0 rounded-xl border border-slate-200 bg-white p-[17px] shadow-sm max-[760px]:p-3';
export const sectionHeading = 'mb-3 flex items-start justify-between gap-3.5';
export const sectionTitle = 'mb-[3px] text-[12px] font-bold text-[#344156]';
export const sectionDescription = 'text-[9px] text-muted-strong';

export const tableScroll = 'overflow-x-auto';
export const tableScrollVisible = 'overflow-visible max-[760px]:overflow-x-auto';
const tableBase = 'w-full border-collapse text-left';
export const table = `${tableBase} min-w-[700px]`;
export const tableResponsibles = `${tableBase} min-w-[720px]`;
export const tableProjects = `${tableBase} min-w-[820px]`;
const th = 'border-y border-[#edf0f5] bg-[#f8f9fc] px-2.5 py-[9px] text-[8px] font-bold tracking-[.04em] whitespace-nowrap text-[#8792a2] uppercase';
const td = 'border-b border-[#edf0f5] p-2.5 align-middle text-[9px] text-[#596576] last:text-right last:whitespace-nowrap';
export const thCell = `${th} last:w-[220px] last:text-right`;
export const tdCell = `${td} last:w-[220px]`;
export const tdCellProjects = `${td} last:w-[270px]`;
export const thCellProjects = `${th} last:w-[270px] last:text-right`;
const badge = 'inline-flex min-h-[22px] items-center rounded-full px-2 py-1 text-[9px] font-semibold whitespace-nowrap';
export const badgeShared = `${badge} bg-success-soft text-success`;
export const badgePrivate = `${badge} bg-warning-soft text-warning`;
export const badgeInUse = 'inline-flex min-h-[22px] items-center rounded-full bg-[#eef1ff] px-[7px] py-0.5 text-[8px] font-semibold whitespace-nowrap text-[#5160c5]';
export const projectTitle = 'flex flex-wrap items-center gap-[7px]';
export const projectName = 'text-[11px] text-[#344156]';
export const repositoryCount = 'inline-flex items-baseline gap-1 whitespace-nowrap text-[#687487]';
export const repositoryCountValue = 'text-[11px] text-[#344156]';
export const rowHover = 'hover:bg-[#fbfcff]';
export const rowSelected = 'bg-[#f6f7ff]';
export const cellStrong = 'text-[10px] text-[#3e4a5e]';
const rowIdBase = 'mt-[3px] block overflow-hidden font-code text-[8px] leading-[normal] text-ellipsis text-[#919baa]';
export const rowId = `${rowIdBase} max-w-[185px]`;
export const rowIdProjects = `${rowIdBase} max-w-[230px]`;
const rowActionsBase = 'flex min-w-0 flex-nowrap items-center justify-end';
export const rowActions = `${rowActionsBase} gap-2`;
export const rowActionsProjects = `${rowActionsBase} gap-[5px]`;

export const emptyState = 'grid justify-items-center gap-2 px-3.5 py-[30px] text-center';
export const emptyTitle = 'font-display text-[13px] leading-[normal] font-bold text-[#394558]';
export const emptyText = 'mb-2 text-[11px] text-[#8993a3]';
export const loading = 'px-[18px] py-7 text-center text-[11px] text-[#8792a2]';
/** Aviso filho direto do diálogo de cadastro (margens do `create-task-dialog`). */
export const dialogNotice = `${notice.error} mx-[22px] mt-[13px]`;

const dialogShell = 'm-auto rounded-ui-lg border border-[#dfe4ed] bg-white text-[#455164] shadow-[0_24px_70px_#18223040] backdrop:bg-[#18203388] backdrop:backdrop-blur-[3px]';
export const recordDialog = `${dialogShell} w-[min(calc(100%-28px),720px)] max-h-[min(850px,calc(100dvh-28px))] overflow-auto`;
export const projectDialog = `${dialogShell} w-[min(calc(100%-28px),1100px)] max-h-[min(900px,calc(100dvh-28px))] overflow-hidden open:flex open:flex-col`;
const header = 'flex items-start justify-between gap-4 border-b border-[#edf0f4] px-[23px] pt-[21px] pb-4 max-[760px]:px-4 max-[760px]:pt-[17px] max-[760px]:pb-[13px]';
export const dialogHeader = header;
export const dialogHeaderFixed = `${header} flex-none`;
export const dialogTitle = 'mb-[5px] font-display text-[17px] leading-[normal] font-bold tracking-[-.035em] text-[#263246]';
export const dialogSubtitle = 'text-[10px] text-muted-strong';
export const iconButton = 'inline-grid size-[30px] flex-none place-items-center rounded-[7px] border border-transparent bg-transparent text-[20px] text-[#8792a2] hover:bg-[#f2f3f8] hover:text-[#4654c0]';
export const dialogFooter = 'flex justify-end border-t border-[#edf0f4] px-[23px] py-3 max-[760px]:px-4 max-[760px]:py-2.5';
export const recordBody = 'grid gap-[13px] px-[22px] py-[17px] max-[760px]:px-4 max-[760px]:py-3.5';

export const detailGrid = 'm-0 grid grid-cols-2 gap-[9px] max-[760px]:grid-cols-1';
export const detailItem = 'min-w-0 rounded-[7px] border border-[#edf0f4] bg-[#fbfcfe] px-2.5 py-[9px]';
export const detailTerm = 'mb-1 text-[8px] text-[#8994a4]';
export const detailValue = 'm-0 text-[10px] wrap-anywhere text-[#455267]';
export const detailSection = 'grid min-w-0 gap-1.5';
export const detailSectionTitle = 'text-[10px] font-bold text-[#465267]';
export const acceptanceList = 'm-0 grid gap-2 pl-[18px] text-[9px] text-[#4a5669]';
export const acceptanceItem = 'pl-0.5';
export const acceptanceStatus = 'mt-[3px] block text-[8px] text-[#8792a2]';
export const repositoryDetail = 'grid gap-[5px] rounded-[7px] border border-[#edf0f4] p-[9px]';
export const repositoryDetailName = 'text-[10px] text-[#435067]';
export const repositoryDetailUrl = 'text-[9px] wrap-anywhere text-[#7f8a9b]';

/** Formulário curto de edição (`stack-form create-task-form catalog-edit-form`). */
export const editForm = 'grid max-h-[calc(100dvh-175px)] gap-[13px] overflow-y-auto px-[22px] pt-4 pb-5 max-[760px]:px-4 max-[480px]:pt-[13px] max-[480px]:pb-4';
export const editLabel = 'grid gap-1.5 text-[10px] font-semibold text-[#566275]';
export const editField = 'w-full resize-y rounded-[7px] border border-[#e1e5ed] bg-white px-2.5 py-[9px] text-[11px] text-[#344054]';
export const editHint = 'text-[9px] leading-[1.5] font-normal text-[#8a94a4]';
