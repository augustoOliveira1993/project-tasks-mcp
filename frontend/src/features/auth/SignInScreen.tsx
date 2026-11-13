import type { FormEventHandler } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/ui/Logo';

type SignInScreenProps = {
  saving: boolean;
  notice: { message: string; kind: string } | null;
  onSubmit: FormEventHandler<HTMLFormElement>;
};

export function SignInScreen({ saving, notice, onSubmit }: SignInScreenProps) {
  const hasError = notice?.kind === 'error';

  return <main className="relative grid min-h-svh place-items-center bg-canvas bg-[radial-gradient(ellipse_at_50%_10%,#e6eaff,#f7f8fc_60%)] p-6 text-foreground">
    <div className="absolute top-7 left-8 flex items-center gap-2.5 font-display text-[13px] font-extrabold text-[#344052]">
      <Logo size={36} title="Project Tasks" /><span>Project Tasks</span>
    </div>
    <section className="w-full max-w-[390px] rounded-[14px] border border-[#e6e9f1] bg-white p-[29px] shadow-card">
      <p className="mb-1.5 font-display text-[9px] leading-[normal] font-bold tracking-[.11em] text-[#7180d8]">PAINEL DE OPERAÇÃO</p>
      <h1 className="mb-2 font-display text-[21px] leading-[normal] font-extrabold tracking-[-.04em] text-[#293548]">Acesse seu workspace</h1>
      <p className="mb-[21px] text-[11px] leading-[1.6] text-[#8290a2]">Entre com seu token humano para consultar projetos e tarefas.</p>
      <form className="grid gap-[15px]" onSubmit={onSubmit}>
        <div className="grid gap-1.5">
          <Label htmlFor="human-token">Token humano</Label>
          <Input id="human-token" name="token" type="password" autoComplete="current-password" spellCheck={false} required autoFocus maxLength={512} placeholder="Cole o token de administrador" />
        </div>
        <Button type="submit" className="min-h-10 w-full text-xs" disabled={saving}>{saving ? 'Validando…' : 'Entrar'}</Button>
      </form>
      <p className="mt-[17px] border-t border-[#f0f2f5] pt-3.5 text-center text-[9px] text-[#9aa3b1]">As ações respeitam as permissões configuradas no servidor.</p>
      {notice && <Alert className="mt-4" variant={hasError ? 'destructive' : 'default'} role={hasError ? 'alert' : 'status'} aria-live={hasError ? 'assertive' : 'polite'}>
        <AlertDescription>{notice.message}</AlertDescription>
      </Alert>}
    </section>
  </main>;
}
