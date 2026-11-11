import type { FormEventHandler } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
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

  return <main className="grid min-h-svh place-items-center bg-background px-4 py-8 text-foreground">
    <Card className="w-full max-w-md gap-0 overflow-hidden">
      <CardHeader className="gap-4 border-b border-border px-6 py-6">
        <div className="flex items-center gap-3">
          <Logo size={38} title="Project Tasks" />
          <div className="min-w-0">
            <CardTitle className="text-base">Project Tasks</CardTitle>
            <CardDescription className="mt-1">Painel de operação</CardDescription>
          </div>
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-balance">Acesse seu workspace</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Entre com seu token humano para consultar projetos e tarefas.</p>
        </div>
      </CardHeader>
      <CardContent className="px-6 py-5">
        <form className="grid gap-4" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="human-token">Token humano</Label>
            <Input id="human-token" name="token" type="password" autoComplete="current-password" spellCheck={false} required maxLength={512} aria-describedby="human-token-help" />
            <p id="human-token-help" className="text-xs leading-5 text-muted-foreground">As ações respeitam as permissões configuradas no servidor.</p>
          </div>
          <Button type="submit" className="w-full" disabled={saving}>{saving ? 'Validando…' : 'Entrar'}</Button>
        </form>
      </CardContent>
      {notice && <CardFooter className="px-6 pb-6">
        <Alert variant={hasError ? 'destructive' : 'default'} role={hasError ? 'alert' : 'status'} aria-live={hasError ? 'assertive' : 'polite'}>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      </CardFooter>}
    </Card>
  </main>;
}
