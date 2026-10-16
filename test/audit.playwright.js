async page => {
  const out = [];
  const errors = [];
  const base = 'http://127.0.0.1:5173/';
  const ok = (name, cond, extra = '') => out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`);
  const step = async (name, fn) => {
    try { await fn(); } catch (e) { out.push(`FAIL  ${name}  → EXCEPCIÓN: ${String(e.message).split('\n')[0]}`); }
  };
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|fonts\.g/.test(m.text() + m.location().url)) errors.push('console: ' + m.text());
  });

  await page.addInitScript(() => {
    const mo = new MutationObserver(() => {
      const r = document.getElementById('root');
      if (r && r.childElementCount && window.__darkAtMount === undefined) {
        window.__darkAtMount = document.documentElement.classList.contains('dark');
        mo.disconnect();
      }
    });
    mo.observe(document, { childList: true, subtree: true });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.goto(base);
  await page.waitForSelector('article');

  await step('base', async () => {
    ok('12 tarjetas de ejemplo', (await page.locator('article').count()) === 12);
    ok('contador "2 agotados"', await page.getByText('2 agotados', { exact: true }).isVisible());
    ok('html lang="es"', (await page.evaluate(() => document.documentElement.lang)) === 'es');
    ok('un solo h1', (await page.locator('h1').count()) === 1);
  });

  await step('táctil', async () => {
    const small = await page.evaluate(() => [...document.querySelectorAll('button')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => { const r = b.getBoundingClientRect(); return { t: (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 22), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((x) => x.w < 44 || x.h < 44));
    ok('objetivos táctiles ≥ 44 px', small.length === 0, JSON.stringify(small));
    await page.setViewportSize({ width: 320, height: 640 });
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok('sin scroll horizontal a 320 px', ov <= 0, `delta=${ov}`);
    await page.setViewportSize({ width: 390, height: 844 });
  });

  const fab = page.getByRole('button', { name: 'Agregar', exact: true });
  const dlg = page.getByRole('dialog', { name: 'Agregar producto' });

  await step('modal agregar', async () => {
    await fab.click();
    ok('modal con role=dialog + nombre accesible', await dlg.isVisible());
    ok('scroll del fondo bloqueado', (await page.evaluate(() => document.body.style.overflow)) === 'hidden');
    await dlg.getByRole('button', { name: 'Agregar a la despensa' }).click();
    ok('error inline si falta el nombre', await dlg.getByRole('alert').getByText('Escribe un nombre').isVisible());
    ok('foco pasa al campo nombre', await page.evaluate(() => document.activeElement?.name === 'nombre'));
    await dlg.locator('input[name=emoji]').fill('🍎🍌');
    ok('emoji: conserva solo el último', (await dlg.locator('input[name=emoji]').inputValue()) === '🍌');
    await dlg.locator('input[name=nombre]').fill('Aceite de oliva');
    await dlg.locator('input[name=cantidad]').fill('0.5');
    await dlg.locator('select[name=unidad]').selectOption('litros');
    await page.mouse.click(5, 5);
    ok('clic en el fondo con cambios NO cierra', await dlg.isVisible());
    await dlg.getByRole('button', { name: 'Agregar a la despensa' }).click();
    ok('modal cierra al guardar (decimal aceptado)', !(await dlg.isVisible()));
    const card = page.locator('article', { hasText: 'Aceite de oliva' });
    ok('cantidad 0,5 con formato es', (await card.innerText()).includes('0,5'));
    ok('foco vuelve al botón Agregar', await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Agregar'));
  });

  await step('modal teclado', async () => {
    await fab.click();
    await dlg.getByRole('button', { name: 'Agregar a la despensa' }).focus();
    await page.keyboard.press('Tab');
    ok('trampa de foco (Tab del último → primero)', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Cerrar'));
    await page.keyboard.press('Escape');
    ok('Escape cierra el modal', !(await dlg.isVisible()));
    ok('scroll del fondo restaurado', (await page.evaluate(() => document.body.style.overflow)) !== 'hidden');
  });

  await step('par: Huevos', async () => {
    const huevos = page.locator('article', { hasText: 'Huevos' });
    for (let i = 0; i < 3; i++) await huevos.getByRole('button', { name: /Restar uno/ }).click();
    await huevos.getByRole('button', { name: 'Agotado' }).click();
    ok('toast al marcar agotado', await page.getByRole('status').getByText('agregado a la lista de compras').isVisible());
    await page.getByRole('button', { name: /Lista de compras/ }).click();
    const li = page.locator('li', { hasText: 'Huevos' });
    ok('lista muestra "Habitual: 12" (no 9)', (await li.innerText()).includes('Habitual: 12'));
    await li.getByRole('button', { name: /Reabastecer/ }).click();
    await page.getByRole('button', { name: 'Todo', exact: true }).click();
    ok('Huevos vuelve con 12', (await page.locator('article', { hasText: 'Huevos' }).innerText()).includes('12'));
  });

  await step('par: Leche (bajar con − hasta 0)', async () => {
    const leche = page.locator('article', { hasText: 'Leche' });
    await leche.getByRole('button', { name: /Restar uno/ }).click();
    await leche.getByRole('button', { name: /Restar uno/ }).click();
    ok('badge "Agotado" visible en tarjeta', await leche.locator('span', { hasText: /^Agotado$/ }).isVisible());
    ok('botón − deshabilitado en agotado', await leche.getByRole('button', { name: /Restar uno/ }).isDisabled());
    await page.getByRole('button', { name: /Lista de compras/ }).click();
    await page.locator('li', { hasText: 'Leche' }).getByRole('button', { name: /Reabastecer/ }).click();
    await page.getByRole('button', { name: 'Todo', exact: true }).click();
    const t = await page.locator('article', { hasText: 'Leche' }).innerText();
    ok('Leche se reabastece a 2 (antes quedaba en 1)', /\b2\b/.test(t) && !t.includes('Agotado\n'), t.replace(/\n/g, ' | '));
  });

  await step('par: editar cantidad', async () => {
    await page.getByRole('button', { name: 'Editar Arroz' }).click();
    const ed = page.getByRole('dialog', { name: 'Editar producto' });
    await ed.locator('input[name=cantidad]').fill('5');
    await ed.getByRole('button', { name: 'Guardar cambios' }).click();
    await page.locator('article', { hasText: 'Arroz' }).getByRole('button', { name: 'Agotado' }).click();
    await page.getByRole('button', { name: /Lista de compras/ }).click();
    const li = page.locator('li', { hasText: 'Arroz' });
    ok('editar a 5 actualiza "Habitual: 5"', (await li.innerText()).includes('Habitual: 5'));
    await li.getByRole('button', { name: /Reabastecer/ }).click();
    await page.getByRole('button', { name: 'Todo', exact: true }).click();
  });

  await step('eliminar + deshacer', async () => {
    await page.getByRole('button', { name: 'Eliminar Queso' }).click();
    ok('Queso eliminado', (await page.locator('article', { hasText: 'Queso' }).count()) === 0);
    await page.getByRole('button', { name: 'Deshacer' }).click();
    ok('Deshacer restaura Queso', (await page.locator('article', { hasText: 'Queso' }).count()) === 1);
  });

  await step('URL y búsqueda', async () => {
    await page.getByRole('button', { name: /Alacena/ }).click();
    ok('URL con ?zona=alacena', page.url().includes('zona=alacena'));
    const search = page.getByRole('searchbox', { name: 'Buscar producto' });
    await search.fill('ar');
    ok('URL con q=ar', page.url().includes('q=ar'));
    await page.reload();
    await page.waitForSelector('article');
    ok('recarga restaura búsqueda', (await page.getByRole('searchbox', { name: 'Buscar producto' }).inputValue()) === 'ar');
    ok('recarga restaura pestaña (aria-pressed)', (await page.getByRole('button', { name: /Alacena/ }).getAttribute('aria-pressed')) === 'true');
    await page.getByRole('searchbox', { name: 'Buscar producto' }).fill('zzz');
    ok('mensaje "Sin resultados"', await page.getByText('Sin resultados para «zzz».').isVisible());
    await page.getByRole('button', { name: /Lista de compras/ }).click();
    ok('"Sin resultados" también en compras', await page.getByText('Sin resultados para «zzz».').isVisible());
    await page.getByRole('searchbox', { name: 'Buscar producto' }).fill('');
    await page.getByRole('button', { name: 'Todo', exact: true }).click();
  });

  await step('almacenamiento', async () => {
    await page.evaluate(() => localStorage.setItem('despensa:items', '{"a":1}'));
    await page.goto(base);
    await page.waitForSelector('article');
    ok('JSON inválido → datos de ejemplo (sin pantalla en blanco)', (await page.locator('article').count()) === 12);
    await page.evaluate(() => localStorage.setItem('despensa:items', JSON.stringify([{ id: 'x', name: 'Sal', emoji: '🧂', zone: 'especias', qty: 0, unit: 'kg', par: 1 }])));
    await page.reload();
    await page.waitForSelector('article');
    ok('singular "1 agotado"', await page.getByText('1 agotado', { exact: true }).isVisible());
  });

  const contrast = () => page.evaluate(() => {
    const rgb = (c) => { const x = document.createElement('canvas'); x.width = x.height = 1; const g = x.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const art = document.querySelector('article:not([class*="red"])') || document.querySelector('article');
    const p = art.querySelector('p');
    const a = lum(rgb(getComputedStyle(p).color)), b = lum(rgb(getComputedStyle(art).backgroundColor));
    return +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
  });

  await step('modo oscuro', async () => {
    await page.evaluate(() => localStorage.clear());
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(base);
    await page.waitForSelector('article');
    const d = await page.evaluate(() => ({ cls: document.documentElement.classList.contains('dark'), cs: document.documentElement.style.colorScheme, atMount: window.__darkAtMount, meta: document.querySelector('meta[name=theme-color]').content }));
    ok('respeta prefers-color-scheme', d.cls && d.cs === 'dark');
    ok('sin parpadeo (dark antes del primer render)', d.atMount === true);
    ok('theme-color oscuro', d.meta === '#0f1a16', d.meta);
    const cd = await contrast();
    ok('contraste texto secundario (oscuro) ≥ 4.5', cd >= 4.5, `${cd}:1`);
    await page.getByRole('button', { name: 'Activar modo claro' }).click();
    const l = await page.evaluate(() => ({ cls: document.documentElement.classList.contains('dark'), v: localStorage.getItem('despensa:dark') }));
    ok('interruptor pasa a claro y persiste', !l.cls && l.v === 'false');
    const cl = await contrast();
    ok('contraste texto secundario (claro) ≥ 4.5', cl >= 4.5, `${cl}:1`);
  });

  ok('sin errores de JS/consola de la app', errors.length === 0, errors.join(' | '));
  return out.join('\n');
}
