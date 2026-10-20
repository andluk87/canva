import { useEffect, useState } from "react";
import { Check, Download, KeyRound, Laptop, LogOut, RefreshCw, ShieldCheck, Smartphone, UserRound } from "lucide-react";
import { api, json, type User } from "./api";
import { Modal } from "./ui";
import "./AccountSettings.css";

type Session = { id: string; current: boolean; created: string | null; expires: string; userAgent: string };
type Security = { twoFactorEnabled: boolean; recoveryCodesRemaining: number; enabledAt: string | null };
type Setup = { secret: string; otpauthUri: string; expires: string };
const date = (value: string) => new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const deviceName = (agent: string) => {
  if (!agent) return "Устройство без описания";
  const os = /Android/i.test(agent) ? "Android" : /iPhone|iPad/i.test(agent) ? "iOS" :
    /Windows/i.test(agent) ? "Windows" : /Macintosh|Mac OS/i.test(agent) ? "macOS" : /Linux/i.test(agent) ? "Linux" : "Устройство";
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" :
    /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Браузер";
  return `${browser} · ${os}`;
};

export default function AccountSettings({ user, onUserChange, onLogout, toast }: {
  user: User; onUserChange: (user: User) => void; onLogout: () => void; toast: (message: string) => void;
}) {
  const [name, setName] = useState(user.name);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [security, setSecurity] = useState<Security | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recovery, setRecovery] = useState<string[]>([]);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [factorPassword, setFactorPassword] = useState("");
  const [factorCode, setFactorCode] = useState("");
  const [error, setError] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const load = async () => {
    const [devices, protection] = await Promise.all([api<{ sessions: Session[] }>("/account/sessions"), api<Security>("/account/security")]);
    setSessions(devices.sessions);
    setSecurity(protection);
  };
  useEffect(() => {
    load().catch((failure) => setError((previous) => ({ ...previous, load: failure.message })));
  }, []);
  useEffect(() => setName(user.name), [user.name]);
  async function perform(area: string, action: () => Promise<void>) {
    setBusy(area);
    setError((previous) => ({ ...previous, [area]: "" }));
    try { await action(); }
    catch (failure) { setError((previous) => ({ ...previous, [area]: (failure as Error).message })); }
    finally { setBusy(""); }
  }
  function saveCodes() {
    const text = "Forma — резервные коды двухфакторной защиты\n\n" + recovery.join("\n") +
      "\n\nКаждый код можно использовать только один раз. Храните отдельно от пароля.\n";
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "forma-recovery-codes.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const disabled = !!busy;
  return <div className="account-settings">
    <div className="account-intro"><span><ShieldCheck size={21} /> Ваше пространство под защитой</span>
      <h1>Настройки аккаунта</h1><p>Профиль, пароль и устройства, на которых вы работаете.</p></div>
    {error.load && <div className="account-error" role="alert">{error.load} <button onClick={() => perform("load", load)}>Повторить</button></div>}
    <div className="account-grid">
      <section className="account-card">
        <div className="account-card-heading"><span><UserRound size={21} /></span><div><h2>Личные данные</h2><p>Так вас видят участники совместных проектов.</p></div></div>
        <form onSubmit={(event) => { event.preventDefault(); void perform("profile", async () => {
          const result = await api<{ user: User }>("/account/profile", json({ name }, "PATCH"));
          onUserChange(result.user); toast("Профиль обновлён");
        }); }}>
          <label htmlFor="account-name">Имя в профиле</label><input id="account-name" name="name" maxLength={100} required value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          <label htmlFor="account-email">Email аккаунта</label><input id="account-email" type="email" value={user.email} readOnly />
          <p className="account-hint">Адрес используется для входа и приглашений в проекты.</p>
          {error.profile && <p className="account-error" role="alert">{error.profile}</p>}
          <button className="primary" disabled={disabled || name.trim() === user.name}>{busy === "profile" ? "Сохраняем…" : "Сохранить профиль"}</button>
        </form>
      </section>
      <section className="account-card">
        <div className="account-card-heading"><span><KeyRound size={21} /></span><div><h2>Пароль</h2><p>После смены другие устройства выйдут из аккаунта.</p></div></div>
        <form onSubmit={(event) => {
          event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form);
          void perform("password", async () => {
            if (fields.get("newPassword") !== fields.get("confirmPassword")) throw new Error("Новые пароли не совпадают");
            await api("/account/password", json({ currentPassword: fields.get("currentPassword"), newPassword: fields.get("newPassword") }));
            form.reset(); await load(); toast("Пароль изменён. Другие сеансы завершены.");
          });
        }}>
          <label htmlFor="account-current-password">Текущий пароль</label><input id="account-current-password" type="password" name="currentPassword" required maxLength={256} autoComplete="current-password" />
          <label htmlFor="account-new-password">Новый пароль</label><input id="account-new-password" type="password" name="newPassword" required minLength={10} maxLength={256} autoComplete="new-password" placeholder="Не менее 10 символов" />
          <label htmlFor="account-confirm-password">Повторите новый пароль</label><input id="account-confirm-password" type="password" name="confirmPassword" required minLength={10} maxLength={256} autoComplete="new-password" />
          {error.password && <p className="account-error" role="alert">{error.password}</p>}
          <button className="account-secondary" disabled={disabled}>{busy === "password" ? "Меняем пароль…" : "Изменить пароль"}</button>
        </form>
      </section>
      <section className="account-card account-wide">
        <div className="account-card-heading"><span><ShieldCheck size={21} /></span><div><h2>Двухфакторная защита</h2><p>Дополнительный одноразовый код при входе в аккаунт.</p></div>
          {security && <b className={"account-status " + (security.twoFactorEnabled ? "enabled" : "")}>{security.twoFactorEnabled ? "Включена" : "Не включена"}</b>}</div>
        {security && <>
          <p className="account-description">{security.twoFactorEnabled ? `Подключено приложение-аутентификатор. Осталось резервных кодов: ${security.recoveryCodesRemaining}.` : "Добавьте аккаунт в Google Authenticator, 1Password, Microsoft Authenticator или другое приложение с поддержкой TOTP."}</p>
          {recovery.length > 0 && <div className="account-recovery" role="region" aria-label="Резервные коды">
            <h3>Сохраните резервные коды</h3><p>Они показываются один раз и помогут войти, если телефон недоступен. Каждый код действует один раз.</p>
            <div className="account-code-grid">{recovery.map((code) => <code key={code}>{code}</code>)}</div>
            <button className="account-secondary" onClick={saveCodes}><Download size={16} /> Скачать коды</button>
            <label className="account-checkbox"><input type="checkbox" checked={recoverySaved} onChange={(event) => setRecoverySaved(event.target.checked)} /> Я сохранил резервные коды</label>
            <button className="primary" disabled={!recoverySaved} onClick={() => { setRecovery([]); setRecoverySaved(false); }}>Готово</button>
          </div>}
          {setup && <div className="account-factor-setup">
            <h3>Подключите приложение</h3><ol><li>Добавьте новый аккаунт в приложении и выберите ввод ключа вручную.</li><li>Укажите аккаунт <b>{user.email}</b>, тип «По времени» и этот ключ:</li></ol>
            <code className="account-secret" aria-label="Ключ аутентификатора">{setup.secret}</code>
            <a className="account-app-link" href={setup.otpauthUri}>Открыть в приложении-аутентификаторе</a>
            <p className="account-hint">Введите шестизначный код из приложения. Настройка действует до {date(setup.expires)}.</p>
          </div>}
          {recovery.length === 0 && <form className="account-factor-form" onSubmit={(event) => { event.preventDefault(); void perform("factor", async () => {
            if (!setup && !security.twoFactorEnabled) {
              setSetup(await api<Setup>("/account/2fa/setup", json({ currentPassword: factorPassword })));
              return;
            }
            if (setup) {
              const result = await api<{ recoveryCodes: string[] }>("/account/2fa/confirm", json({ currentPassword: factorPassword, code: factorCode }));
              setRecovery(result.recoveryCodes); setRecoverySaved(false); setSetup(null); setFactorPassword(""); setFactorCode("");
              await load(); toast("Двухфакторная защита включена");
            }
          }); }}>
            <div><label htmlFor="account-factor-password">Пароль для управления защитой</label><input id="account-factor-password" type="password" required maxLength={256} autoComplete="current-password" value={factorPassword} onChange={(event) => setFactorPassword(event.target.value)} /></div>
            {(setup || security.twoFactorEnabled) && <div><label htmlFor="account-factor-code">Код аутентификатора или резервный код</label><input id="account-factor-code" value={factorCode} onChange={(event) => setFactorCode(event.target.value)} maxLength={100} autoComplete="one-time-code" placeholder={setup ? "000000" : "Код из приложения или резервный"} required /></div>}
            <div className="account-factor-actions">{!security.twoFactorEnabled && <button className="primary" disabled={disabled}>{busy === "factor" ? "Проверяем…" : setup ? "Подтвердить подключение" : "Настроить защиту"}</button>}
              {setup && <button className="account-secondary" type="button" disabled={disabled} onClick={() => { setSetup(null); setFactorPassword(""); setFactorCode(""); }}>Отмена</button>}
              {security.twoFactorEnabled && <>
                <button type="button" className="account-secondary" disabled={disabled || !factorPassword || !factorCode} onClick={() => perform("factor", async () => {
                  const result = await api<{ recoveryCodes: string[] }>("/account/2fa/recovery", json({ currentPassword: factorPassword, code: factorCode }));
                  setRecovery(result.recoveryCodes); setRecoverySaved(false); setFactorPassword(""); setFactorCode(""); await load(); toast("Созданы новые резервные коды");
                })}>Обновить резервные коды</button>
                <button type="button" className="account-danger" disabled={disabled || !factorPassword || !factorCode} onClick={() => perform("factor", async () => {
                  await api("/account/2fa/disable", json({ currentPassword: factorPassword, code: factorCode }));
                  setFactorPassword(""); setFactorCode(""); await load(); toast("Двухфакторная защита отключена");
                })}>Отключить защиту</button>
              </>}
            </div>
          </form>}
          {error.factor && <p className="account-error" role="alert">{error.factor}</p>}
        </>}
      </section>
      <section className="account-card account-wide">
        <div className="account-card-heading"><span><Laptop size={21} /></span><div><h2>Активные сеансы</h2><p>Завершите сеанс на устройстве, к которому у вас больше нет доступа.</p></div>
          <button aria-label="Обновить сеансы" className="account-icon" disabled={disabled} onClick={() => perform("sessions", load)}><RefreshCw size={18} /></button></div>
        <div className="account-session-list">{sessions.map((session) => <div className="account-session" key={session.id}>
          <span className="account-device-icon">{/Android|iPhone|iPad/i.test(session.userAgent) ? <Smartphone size={22} /> : <Laptop size={22} />}</span>
          <div><b>{deviceName(session.userAgent)}</b>{session.current && <span className="account-current"><Check size={12} /> Этот сеанс</span>}
            <p>{session.created ? "Вход: " + date(session.created) : "Дата входа недоступна"} · действует до {date(session.expires)}</p></div>
          {!session.current && <button className="account-danger" disabled={disabled} onClick={() => perform("sessions", async () => {
            await api("/account/sessions/" + session.id, { method: "DELETE" }); await load(); toast("Сеанс завершён");
          })}>Завершить сеанс</button>}
        </div>)}</div>
        {error.sessions && <p className="account-error" role="alert">{error.sessions}</p>}
        <div className="account-session-footer"><p>Если вы заметили незнакомое устройство, завершите его сеанс и измените пароль.</p>
          <button className="account-danger" disabled={disabled} onClick={() => setConfirmLogout(true)}><LogOut size={16} /> Выйти на всех устройствах</button></div>
      </section>
    </div>
    {confirmLogout && <Modal title="Выйти на всех устройствах?" onClose={() => !busy && setConfirmLogout(false)}><div className="account-logout-modal">
      <p>Все активные сеансы, включая этот, будут завершены. Сохранённые проекты останутся в вашем аккаунте.</p>
      {error.logout && <p className="account-error" role="alert">{error.logout}</p>}
      <div><button className="account-secondary" disabled={disabled} onClick={() => setConfirmLogout(false)}>Отмена</button>
        <button className="account-danger" disabled={disabled} onClick={() => perform("logout", async () => {
          await api("/account/logout-all", json({})); onLogout(); toast("Все сеансы завершены");
        })}>{busy === "logout" ? "Завершаем…" : "Выйти везде"}</button></div></div></Modal>}
  </div>;
}
