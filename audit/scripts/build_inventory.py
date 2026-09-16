"""Check source coverage and write the page/component inventory."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIT = ROOT / 'audit'
manifest = json.loads((AUDIT / 'manifest.json').read_text())
shots = {x['id'].split('-')[0]: x for x in sorted(manifest, key=lambda x: len(x['id']), reverse=True)}
# Source basename: representative screenshot IDs. Helpers with no standalone UI use related captures.
coverage = {
'sidebar': '170 030', 'clientRuntime': '102 120', 'sidebarButton': '170 115',
'sheetList': '019 086', 'sheetGrid': '086 087 088 089 090 091 092 093 094 095 096 097 098 119 180',
'stageBoard': '072', 'stageCatalog': '072 117', 'richTextEditor': '080 082 083 105 106 107 179',
'slashMenu': '082', 'mentionMenu': '083', 'codeBlockView': '106', 'mention': '183',
'dismissSuggestion': '082', 'slashCommand': '082', 'autoCapitalize': '080', 'codeHighlight': '106', 'caretPopup': '082 083', 'dotBullet': '080',
'docList': '018 080 118', 'todayDashboard': '006 014 065 066 067 171 172 173 174 175',
'workspaceSettings': '043 074 075 076 077', 'workingHoursSettings': '041 178', 'apiKeysSettings': '045 100',
'dataSettings': '044 101', 'namedColorEditor': '075 076', 'accountSettings': '040', 'customFieldEditor': '077 078 079', 'notificationSettings': '042',
'confirmDialog': '064', 'select': '058 079 182', 'recurrenceEditor': '059 060 061', 'toastHost': '066 186',
'loadError': '108 109', 'colorPicker': '074', 'saveStatus': '083 106', 'timezoneSelect': '041 042',
'customFieldControl': '181 182', 'keyboardShortcuts': '037 031', 'labelPicker': '063 112', 'colorChip': '016 070',
'datePicker': '026', 'workspaceQuickCreate': '111 112', 'emptyState': '006 009 013',
'entityModal': '057 176', 'addItem': '031 032 033 034 035 036 110 176', 'search': '037 038 039',
'entityDetailPanel': '056 057 062 063 068 069 177 181', 'taskToolbar': '049 050 051 052',
'ganttView': '047', 'taskTypeToggle': '031 069', 'bulkActionBar': '053 186', 'taskExecution': '062 065',
'kanbanView': '046', 'tasktable': '016 048', 'taskScheduleSection': '059 061 063',
'projectTaskList': '071', 'entityDetailHost': '068',
'agendaView': '024', 'waitingForSlotRail': '021 024', 'autoScheduleIndicator': '164', 'weekView': '022',
'autoScheduleDialog': '028 114 163', 'monthView': '021', 'scheduleDialog': '025 027',
'dayView': '023', 'timeGrid': '022 023', 'eventDialog': '029',
}
nonvisual = {'dismissSuggestion', 'slashCommand', 'autoCapitalize', 'codeHighlight', 'caretPopup', 'dotBullet', 'keyboardShortcuts'}
rows = []
for path in sorted((ROOT / 'apps/web/app/_components').rglob('*')):
    if path.suffix not in {'.tsx', '.ts'}: continue
    name = path.stem
    if name not in coverage: raise SystemExit(f'Unmapped component: {path}')
    symbols = re.findall(r'(?:function\s+|(?:export\s+)?const\s+)([A-Z][A-Za-z0-9]+)', path.read_text())
    # Filter configuration constants; keep component names, including named subcomponents.
    symbols = sorted(set(x for x in symbols if not x.isupper()))
    refs = []
    for key in coverage[name].split():
        if key in shots:
            x = shots[key]
            refs.append(f"[{x['id']}]({x['file']})")
    if not refs: raise SystemExit(f'No screenshots for {path}')
    status = 'Nonvisual behavior; related UI shown' if name in nonvisual else 'Rendered in linked captures'
    rows.append({'source': str(path.relative_to(ROOT)), 'symbols': symbols, 'status': status, 'screenshots': coverage[name].split()})
    rows[-1]['links'] = ', '.join(refs)

routes = {'/':'000', '/login':'001 002', '/signup':'003', '/onboarding':'004', '/today':'006 014', '/inbox':'007 015 068', '/calendar':'005 021 022 023 024', '/tasks':'008 016 046 047 056', '/projects':'009 017', '/projects/[id]':'070 071 072 073', '/docs':'010 018', '/docs/[id]':'080 104', '/sheets':'011 019', '/sheets/[id]':'086', '/report':'012 020 184', '/notifications':'013 115 116 185', '/settings':'040 041 042 043 044 045'}
page_rows=[]
for path in sorted((ROOT / 'apps/web/app').rglob('page.tsx')):
    parts = [s for s in path.relative_to(ROOT / 'apps/web/app').parts[:-1] if not s.startswith('(')]
    route = '/' + '/'.join(parts)
    if route not in routes: raise SystemExit(f'Unmapped page: {route}')
    refs = [f"[{shots[k]['id']}]({shots[k]['file']})" for k in routes[route].split() if k in shots]
    symbols=sorted(set(re.findall(r'(?:function\s+|const\s+)([A-Z][A-Za-z0-9]+)',path.read_text())))
    page_rows.append({'source':str(path.relative_to(ROOT)), 'route':route, 'symbols':symbols,'screenshots': routes[route].split(),'links':', '.join(refs)})

text = f'''# Complete source inventory\n\n[Main audit](../Audit.Md) · [Screenshot gallery](index.html)\n\nInventory of **{len(page_rows)} page source files** and **{len(rows)} component source files** at commit `65ae32a5dd97adb83f5badc17b6bc6e7dcee0c89`. Nested components are listed with their owning file. A screenshot can cover several components; wrappers and logic helpers do not have independent visual surfaces. These are representative rendered states, not a claim that every possible data combination or interaction is tested.\n\n## All pages\n\n| Route | Source and local component symbols | Screenshots |\n| --- | --- | --- |\n'''
for r in page_rows:
    text += f"| `{r['route']}` | [{r['source']}](../{r['source']})<br>{', '.join(r['symbols'])} | {r['links']} |\n"
text += '\n## All component files\n\n| Source and component symbols | Coverage | Screenshots |\n| --- | --- | --- |\n'
for r in rows:
    text += f"| [{r['source']}](../{r['source']})<br>{', '.join(r['symbols']) or 'Extension / helper'} | {r['status']} | {r['links']} |\n"
text += '''\n## App infrastructure and Electron\n\n- `app/layout.tsx`: document, fonts, skip link, global providers. Shown across pages.\n- `app/providers.tsx`: query cache and runtime provider; no independent visual component.\n- `(nav_pages)/layout.tsx`: sidebar, search, creation/detail hosts, notifications and page container.\n- `docs/layout.tsx`, `sheets/layout.tsx`: persistent list panes and content split.\n- `proxy.ts`: login/onboarding access gates and legacy `/m` redirect; no standalone screen.\n- `electron/main.ts`: application window, File/Edit/View/Window menus, external-link handling, single-instance lifecycle and startup error dialog. Actual Linux renderer captured; platform menus, startup failure, macOS and Windows were reviewed in source only.\n- `electron/preload.ts`: platform/version bridge, no independent screen.\n- Stores, hooks, API clients, types, formatting/formula/scheduling utilities and global CSS support these surfaces; they are not independent screenshot targets.\n'''
(AUDIT / 'component-inventory.md').write_text(text)
for r in rows + page_rows: r.pop('links')
(AUDIT / 'source-inventory.json').write_text(json.dumps({'pages':page_rows,'components':rows},indent=2))
print(f'Covered {len(page_rows)} pages, {len(rows)} component files ({len(nonvisual)} nonvisual helpers)')
