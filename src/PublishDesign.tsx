import { useEffect, useState } from "react";
import { Copy, ExternalLink, Globe, RefreshCw, ShieldX } from "lucide-react";
import { api, json } from "./api";
import { Modal } from "./ui";
import "./publications.css";

type Publication = {
  token: string; version: number; sourceRevision: number; url: string;
  created: string; updated: string; expiresAt: string | null;
  revoked: boolean; expired: boolean;
};
export default function PublishDesign({ projectId, onClose, toast }: {
  projectId: string; onClose: () => void; toast: (s: string) => void;
}) {
  const [publications, setPublications] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState("");
  const [error, setError] = useState(""), [days, setDays] = useState("7");
  const [revoke, setRevoke] = useState("");
  const endpoint = `/projects/${projectId}/publications`;
  async function load() {
    const data = await api<{ publications: Publication[] }>(endpoint);
    setPublications(data.publications);
  }
  useEffect(() => {
    let cancelled = false;
    api<{ publications: Publication[] }>(endpoint)
      .then((data) => { if (!cancelled) setPublications(data.publications); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [endpoint]);
  async function publish(token?: string) {
    setBusy(token || "new"); setError("");
    try {
      await api(endpoint + (token ? `/${token}` : ""), json(
        { expiresInDays: days === "unlimited" ? null : Number(days) }, token ? "PUT" : "POST",
      ));
      await load();
      toast(token ? "Опубликованный снимок обновлён" : "Ссылка на снимок создана");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  }
  async function withdraw(token: string) {
    setBusy(token); setError("");
    try {
      await api(`${endpoint}/${token}`, { method: "DELETE" });
      await load(); setRevoke(""); toast("Публичная ссылка отозвана");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  }
  async function copy(publication: Publication) {
    const link = new URL(publication.url, window.location.origin).href;
    try { await navigator.clipboard.writeText(link); toast("Ссылка скопирована"); }
    catch { setError("Выделите ссылку в поле и скопируйте её вручную"); }
  }
  return <Modal title="Опубликовать дизайн" onClose={onClose}>
    <div className="publish-design">
      <div className="publish-intro"><Globe size={24} /><div>
        <strong>Снимок для просмотра по ссылке</strong>
        <p>Любой получатель ссылки увидит сохранённые страницы без входа в аккаунт.
          Изменения в редакторе попадут в снимок после явного обновления публикации.</p>
      </div></div>
      <p className="publish-note">Публикуется только дизайн: участники, комментарии и история проекта остаются приватными.
        Сохранённые получателями копии нельзя отозвать.</p>
      <label className="publish-expiry">Срок действия ссылки
        <select aria-label="Срок действия ссылки" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="1">1 день</option><option value="7">7 дней</option>
          <option value="30">30 дней</option><option value="unlimited">Без ограничения</option>
        </select>
      </label>
      {error && <p className="publish-error" role="alert">{error}</p>}
      <button className="primary-button publish-create" disabled={loading || !!busy} onClick={() => void publish()}>
        <Globe size={16} />{busy === "new" ? "Создаём снимок…" : "Создать публичную ссылку"}
      </button>
      <div className="publication-list" aria-live="polite">
        {loading ? <p>Загружаем публикации…</p> : publications.length === 0
          ? <p className="publish-note">Публичных ссылок пока нет. Доступ к проекту остаётся приватным.</p>
          : publications.map((publication) => <article className="publication-card" key={publication.token}>
            <div className="publication-card-heading"><strong>Снимок · версия {publication.version}</strong>
              <span>{publication.revoked ? "Отозвана" : publication.expired ? "Срок истёк" : "Активна"}</span></div>
            <p>Ревизия проекта {publication.sourceRevision} · {publication.expiresAt
              ? `до ${new Date(publication.expiresAt).toLocaleString("ru-RU")}` : "без ограничения срока"}</p>
            {!publication.revoked && <>
              <input aria-label={`Публичная ссылка, версия ${publication.version}`} readOnly
                value={new URL(publication.url, window.location.origin).href} onFocus={(e) => e.target.select()} />
              <div className="publication-actions">
                <button disabled={!!busy} onClick={() => void copy(publication)}><Copy size={14} />Копировать</button>
                <a href={publication.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Открыть</a>
                <button disabled={!!busy} onClick={() => void publish(publication.token)}><RefreshCw size={14} />Обновить снимок</button>
                <button className="publication-danger" disabled={!!busy} onClick={() => setRevoke(publication.token)}>
                  <ShieldX size={14} />Отозвать ссылку</button>
              </div>
              {revoke === publication.token && <div className="publication-confirm" role="group" aria-label="Подтвердить отзыв ссылки">
                <p>Ссылка перестанет открываться у всех получателей. Восстановить её нельзя.</p>
                <button className="publication-danger" disabled={!!busy} onClick={() => void withdraw(publication.token)}>
                  Подтвердить отзыв</button>
                <button disabled={!!busy} onClick={() => setRevoke("")}>Отмена</button>
              </div>}
            </>}
          </article>)}
      </div>
    </div>
  </Modal>;
}
