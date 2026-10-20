import { randomBytes } from 'node:crypto';
import { parseCSV, documentVariables, textVariables, replaceVariables, personalizeDocument } from '../shared/csv.mjs';

const MAX_OUTPUT_BYTES = 30_000_000;
/** Register against the application's own authentication, ACL and document validator. */
export function registerBulk(app, { db, auth, access, write, validDocument }) {
  app.post('/api/projects/:id/bulk', auth, access, write, (req, res, next) => {
    if (req.project.deleted) return res.status(410).json({ error: 'Сначала восстановите исходный проект из корзины' });
    const { csv, titlePattern, mode = 'projects' } = req.body || {};
    if (mode !== 'projects') return res.status(400).json({ error: 'Поддерживается режим отдельных проектов: projects' });
    if (titlePattern !== undefined && (typeof titlePattern !== 'string' || !titlePattern.trim() || titlePattern.length > 1000))
      return res.status(400).json({ error: 'Шаблон названия должен содержать от 1 до 1000 символов' });
    let prepared, variables;
    try {
      const parsed = parseCSV(csv);
      const source = JSON.parse(req.project.document);
      if (!validDocument(source)) throw new Error('Исходный документ некорректен');
      variables = [...new Set([...documentVariables(source), ...textVariables(titlePattern || '')])];
      const missing = variables.filter((name) => !parsed.headers.includes(name));
      if (missing.length) throw new Error('В CSV отсутствуют столбцы: ' + missing.join(', '));
      let bytes = 0;
      prepared = parsed.rows.map((row, index) => {
        const title = titlePattern ? replaceVariables(titlePattern, row).trim() : `${req.project.title.slice(0, 185)} — ${index + 1}`;
        if (!title || title.length > 200) throw new Error(`Строка ${index + 2}: название должно содержать от 1 до 200 символов`);
        const document = personalizeDocument(source, row);
        if (!validDocument(document)) throw new Error(`Строка ${index + 2}: получен слишком большой или некорректный документ`);
        const serialized = JSON.stringify(document);
        bytes += Buffer.byteLength(serialized);
        if (bytes > MAX_OUTPUT_BYTES) throw new Error('Общий объём дизайнов превышает 30 МБ. Уменьшите число строк или размер исходного проекта');
        return { id: randomBytes(16).toString('hex'), title, document, serialized };
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    // Validation finishes before BEGIN; any insert failure rolls back every copy.
    db.exec('BEGIN');
    try {
      const insert = db.prepare('INSERT INTO projects(id,owner_id,title,kind,width,height,document,created,updated) VALUES(?,?,?,?,?,?,?,?,?)');
      const created = new Date().toISOString();
      for (const project of prepared)
        insert.run(project.id, req.user.id, project.title, req.project.kind, req.project.width, req.project.height, project.serialized, created, created);
      const read = db.prepare('SELECT * FROM projects WHERE id=?');
      const projects = prepared.map((p) => ({ ...read.get(p.id), document: p.document, role: 'owner' }));
      db.exec('COMMIT');
      res.status(201).json({ projects, count: projects.length, variables });
    } catch (error) {
      db.exec('ROLLBACK');
      next(error);
    }
  });
}
