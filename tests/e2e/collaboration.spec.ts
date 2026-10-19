import { test, expect } from "@playwright/test";
test("AT-12/13: two editors converge, local undo keeps remote edits, viewer and revoked access", async ({
  browser,
  baseURL,
}) => {
  const a = await browser.newContext({ baseURL }),
    b = await browser.newContext({ baseURL }),
    v = await browser.newContext({ baseURL });
  const errors: string[] = [];
  try {
    const suffix = Date.now();
    for (const [context, name] of [
      [a, "Owner"],
      [b, "Editor"],
      [v, "Reader"],
    ] as const) {
      const r = await context.request.post("/api/auth/register", {
        data: {
          name,
          email: `designer-live-${name}-${suffix}@example.test`,
          password: "test-password-2026",
        },
      });
      expect(r.ok()).toBeTruthy();
    }
    const created = await (
      await a.request.post("/api/projects", {
        data: {
          title: "Live design",
          width: 800,
          height: 800,
          document: {
            pages: [
              {
                id: "page-live",
                canvas: {
                  background: "#fff",
                  objects: [
                    {
                      id: "shared-rect",
                      type: "Rect",
                      left: 30,
                      top: 40,
                      width: 140,
                      height: 100,
                      fill: "#7048ed",
                    },
                  ],
                },
              },
            ],
          },
        },
      })
    ).json();
    const id = created.project.id;
    for (const [name, role] of [
      ["Editor", "editor"],
      ["Reader", "viewer"],
    ])
      expect(
        (
          await a.request.post(`/api/projects/${id}/members`, {
            data: {
              email: `designer-live-${name}-${suffix}@example.test`,
              role,
            },
          })
        ).ok(),
      ).toBeTruthy();
    const owner = await a.newPage(),
      editor = await b.newPage(),
      reader = await v.newPage();
    let transport: any = null,
      block = false;
    await editor.routeWebSocket("**/live", (route) => {
      if (block) {
        route.close({ code: 1012 });
        return;
      }
      transport = route;
      route.connectToServer();
    });
    for (const p of [owner, editor, reader])
      p.on("pageerror", (e) => errors.push(e.message));
    await Promise.all(
      [owner, editor, reader].map((p) => p.goto("/?project=" + id)),
    );
    for (const p of [owner, editor, reader])
      await expect(p.locator(".live-presence")).toContainText("3 онлайн");
    await owner
      .locator(".editor-nav")
      .getByRole("button", { name: "Текст", exact: true })
      .click();
    await editor
      .locator(".editor-nav")
      .getByRole("button", { name: "Элементы", exact: true })
      .click();
    await Promise.all([
      owner
        .getByRole("button", { name: "Добавить заголовок", exact: true })
        .click(),
      editor.getByLabel("Добавить circle", { exact: true }).click(),
    ]);
    const snapshot = async () => {
      const r = await a.request.get("/api/projects/" + id);
      return (await r.json()).project;
    };
    await expect
      .poll(
        async () => (await snapshot()).document.pages[0].canvas.objects.length,
      )
      .toBe(3);
    for (const p of [owner, editor, reader]) {
      await p
        .locator(".editor-nav")
        .getByRole("button", { name: "Слои", exact: true })
        .click();
      await expect(p.locator(".layer-row")).toHaveCount(3);
    }
    await owner.getByLabel("Отменить", { exact: true }).click();
    await expect
      .poll(async () =>
        (await snapshot()).document.pages[0].canvas.objects
          .map((o: any) => o.type)
          .sort(),
      )
      .toEqual(["Circle", "Rect"]);
    await expect(editor.locator(".layer-row")).toHaveCount(2);
    await owner.getByLabel("Повторить", { exact: true }).click();
    await expect
      .poll(
        async () => (await snapshot()).document.pages[0].canvas.objects.length,
      )
      .toBe(3);
    await expect(editor.locator(".layer-row")).toHaveCount(3);
    await Promise.all(
      [owner, editor].map((p) =>
        p.locator(".layer-name").filter({ hasText: "Прямоугольник" }).click(),
      ),
    );
    await Promise.all([
      owner.getByLabel("Положение X", { exact: true }).fill("155"),
      editor.getByLabel("Цвет объекта", { exact: true }).fill("#ff5522"),
    ]);
    await expect
      .poll(async () => {
        const o = (await snapshot()).document.pages[0].canvas.objects.find(
          (o: any) => o.id === "shared-rect",
        );
        return [o.left, o.fill];
      })
      .toEqual([155, "#ff5522"]);
    await expect(owner.getByLabel("Цвет объекта", { exact: true })).toHaveValue(
      "#ff5522",
    );
    await expect(editor.getByLabel("Положение X", { exact: true })).toHaveValue(
      "155",
    );
    // Presence cursors are transient and do not modify the document.
    await owner.locator(".upper-canvas").hover({ position: { x: 10, y: 15 } });
    await expect(editor.locator(".remote-cursor")).toHaveCount(1);
    await reader
      .locator(".editor-nav")
      .getByRole("button", { name: "Текст", exact: true })
      .click();
    await expect(
      reader.getByRole("button", { name: "Добавить заголовок", exact: true }),
    ).toBeDisabled();
    block = true;
    transport.close({ code: 1012 });
    await expect(editor.locator(".live-presence")).toContainText("Нет связи");
    await editor
      .locator(".editor-nav")
      .getByRole("button", { name: "Текст", exact: true })
      .click();
    await editor
      .getByRole("button", { name: "Добавить основной текст", exact: true })
      .click();
    block = false;
    await expect
      .poll(
        async () => (await snapshot()).document.pages[0].canvas.objects.length,
        { timeout: 20000 },
      )
      .toBe(4);
    await expect(owner.locator(".layer-row")).toHaveCount(4);
    const member = (
      await (await a.request.get(`/api/projects/${id}/members`)).json()
    ).members.find((m: any) => m.role === "editor");
    expect(
      (await a.request.delete(`/api/projects/${id}/members/${member.id}`)).ok(),
    ).toBeTruthy();
    await expect(editor.locator(".save-status")).toContainText(
      "Только просмотр",
    );
    await expect(
      editor.getByRole("button", {
        name: "Добавить основной текст",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(owner.locator(".live-presence")).toContainText("2 онлайн");
    await owner.getByLabel("Название проекта").fill("Live after revoke");
    await expect(reader.getByLabel("Название проекта")).toHaveValue(
      "Live after revoke",
    );
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([a.close(), b.close(), v.close()]);
  }
});
