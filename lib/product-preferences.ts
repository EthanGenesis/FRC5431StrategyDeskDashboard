import type {
  AnalyticsSemanticDirection,
  LanguageCode,
  SemanticTone,
  ThemeId,
  WebhookEventKey,
} from './types';

type TranslationDictionary = Record<string, string>;

type TranslateVars = Record<string, string | number | null | undefined>;

const LANGUAGE_LOCALES: Record<LanguageCode, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
};

export const THEME_OPTIONS: { id: ThemeId; labelKey: string; preview: string }[] = [
  {
    id: 'graphite-dark',
    labelKey: 'settings.theme.graphite_dark',
    preview: 'Graphite / Dark',
  },
  {
    id: 'light-slate',
    labelKey: 'settings.theme.light_slate',
    preview: 'Light / Slate',
  },
  {
    id: 'cyan-night',
    labelKey: 'settings.theme.cyan_night',
    preview: 'Cyan / Night',
  },
];

export const LANGUAGE_OPTIONS: { id: LanguageCode; labelKey: string; nativeLabel: string }[] = [
  { id: 'en', labelKey: 'settings.language.en', nativeLabel: 'English' },
  { id: 'es', labelKey: 'settings.language.es', nativeLabel: 'Español' },
  { id: 'fr', labelKey: 'settings.language.fr', nativeLabel: 'Français' },
];

export const WEBHOOK_EVENT_OPTIONS: { id: WebhookEventKey; labelKey: string }[] = [
  { id: 'queue_5', labelKey: 'settings.webhook.event.queue_5' },
  { id: 'queue_2', labelKey: 'settings.webhook.event.queue_2' },
  { id: 'queue_1', labelKey: 'settings.webhook.event.queue_1' },
  { id: 'playing_now', labelKey: 'settings.webhook.event.playing_now' },
  { id: 'mode_changed', labelKey: 'settings.webhook.event.mode_changed' },
  { id: 'snapshot_failed', labelKey: 'settings.webhook.event.snapshot_failed' },
  { id: 'snapshot_recovered', labelKey: 'settings.webhook.event.snapshot_recovered' },
  { id: 'manual_load_failed', labelKey: 'settings.webhook.event.manual_load_failed' },
  { id: 'warning', labelKey: 'settings.webhook.event.warning' },
  { id: 'test', labelKey: 'settings.webhook.event.test' },
];

const EN_TRANSLATIONS: TranslationDictionary = {
  'clock.label': 'Current local time',
  'chart.empty.title': 'No chart data available',
  'chart.empty.description': 'Load a dataset or switch to a scope that has chartable values.',
  'game_manual.default_title': '2026 FRC Game Manual',
  'game_manual.summary': 'Official FIRST game manual embedded as a searchable in-app reader.',
  'game_manual.last_updated': 'Last updated: {{value}}',
  'game_manual.open_html': 'Open Official HTML',
  'game_manual.open_pdf': 'Open Official PDF',
  'game_manual.search_placeholder': 'Search the 2026 game manual',
  'game_manual.search_results': 'Search Results',
  'game_manual.toc': 'Table Of Contents',
  'game_manual.loading': 'Loading game manual...',
  'game_manual.unavailable': 'Game Manual Unavailable',
  'game_manual.matching_sections': '{{count}} matching sections',
  'game_manual.sections_loaded': '{{count}} sections loaded',
  'game_manual.no_results': 'No manual sections matched your search. Try a broader term.',
  'raw_payload.route': 'DATA Route',
  'raw_payload.snapshot': 'Snapshot',
  'compare.add_teams': 'Add teams',
  'compare.add_from_current_event': 'Add from current event',
  'compare.add_current_event_team': 'Add current-event team',
  'compare.baseline': 'Baseline',
  'compare.save_set': 'Save set',
  'compare.load_saved_set': 'Load saved set',
  'compare.current_compare': 'Current Compare',
  'compare.historical_compare': 'Historical Compare',
  'compare.loaded_event_title': 'Loaded Event Compare',
  'compare.historical_title': 'Historical 2026 Compare',
  'compare.loaded_event_description': 'Current-event-only compare table and narratives.',
  'compare.historical_description':
    'Historical-only compare table using 2026 data excluding the loaded event.',
  'compare.add_to_start': 'Add teams to start comparing.',
  'compare.charts_description': 'Metric and distribution charting for the active compare set.',
  'district.title': 'District Points',
  'district.load_fit_event': 'Load a FIT district event to use the district points suite.',
  'district.current_title': 'Current District Event',
  'district.historical_title': 'Historical District Season',
  'district.summary': 'FIT district points built from official TBA data plus EPA-based simulation.',
  'district.runs': 'Runs',
  'district.loading_snapshot': 'Loading district snapshot...',
  'nav.major.current': 'CURRENT',
  'nav.major.historical': 'HISTORICAL',
  'nav.major.predict': 'PREDICT',
  'nav.major.settings': 'SETTINGS',
  'nav.sub.current.now': 'NOW',
  'nav.sub.current.schedule': 'SCHEDULE',
  'nav.sub.current.match': 'MATCH',
  'nav.sub.current.strategy': 'STRATEGY',
  'nav.sub.current.game_manual': 'GAME MANUAL',
  'nav.sub.current.district': 'DISTRICT',
  'nav.sub.current.compare': 'COMPARE',
  'nav.sub.current.team_profile': 'TEAM PROFILE',
  'nav.sub.current.rankings': 'RANKINGS',
  'nav.sub.current.playoffs': 'PLAYOFFS',
  'nav.sub.current.event': 'EVENT',
  'nav.sub.current.data': 'DATA',
  'nav.sub.historical.pre_event': 'PRE_EVENT',
  'nav.sub.historical.strategy': 'STRATEGY',
  'nav.sub.historical.district': 'DISTRICT',
  'nav.sub.historical.compare': 'COMPARE',
  'nav.sub.historical.team_profile': 'TEAM PROFILE',
  'nav.sub.historical.rankings': 'RANKINGS',
  'nav.sub.historical.playoffs': 'PLAYOFFS',
  'nav.sub.historical.event': 'EVENT',
  'nav.sub.historical.data': 'DATA',
  'nav.sub.predict.predict': 'PREDICT',
  'nav.sub.predict.alliance': 'ALLIANCE',
  'nav.sub.predict.playoff_lab': 'PLAYOFF LAB',
  'nav.sub.predict.impact': 'IMPACT',
  'nav.sub.predict.pick_list': 'PICK LIST',
  'nav.sub.predict.live_alliance': 'LIVE ALLIANCE',
  'page.current.now.eyebrow': 'Current / Overview',
  'page.current.now.title': 'Live Match Queue',
  'page.current.now.description':
    'Monitor the next match, rival pressure, countdown context, and the few things that matter most right now.',
  'page.current.schedule.eyebrow': 'Current / Schedule',
  'page.current.schedule.title': 'Event Schedule',
  'page.current.schedule.description':
    'Track our remaining matches, timing pressure, and the teams we need to prepare for next.',
  'page.current.match.eyebrow': 'Current / Match',
  'page.current.match.title': 'Match Detail',
  'page.current.match.description':
    'Review one match deeply with alliance context, predictions, and tactical implications before queuing.',
  'page.current.strategy.eyebrow': 'Current / Strategy',
  'page.current.strategy.title': 'Strategy Workspace',
  'page.current.strategy.description':
    'Build and save match plans, field diagrams, and team notes without losing live event context.',
  'page.current.game_manual.eyebrow': 'Current / Reference',
  'page.current.game_manual.title': '2026 Game Manual',
  'page.current.game_manual.description':
    'Search, read, and reference the official manual in-product while staying in your event workflow.',
  'page.current.district.eyebrow': 'Current / District',
  'page.current.district.title': 'District Points',
  'page.current.district.description':
    'See live district context, event distributions, and manual what-if calculations for the current event.',
  'page.current.compare.eyebrow': 'Current / Compare',
  'page.current.compare.title': 'Team Comparison',
  'page.current.compare.description':
    'Compare shortlists, evaluate role fit, and keep the exact numbers visible across teams.',
  'page.current.team_profile.eyebrow': 'Current / Team Profile',
  'page.current.team_profile.title': 'Team Profile',
  'page.current.team_profile.description':
    "Open a single team's live event view with scouting context, analytics, and season framing.",
  'page.current.rankings.eyebrow': 'Current / Rankings',
  'page.current.rankings.title': 'Rankings Pressure',
  'page.current.rankings.description':
    'Understand ranking movement, RP pressure, and the neighbors who matter most to our current position.',
  'page.current.playoffs.eyebrow': 'Current / Playoffs',
  'page.current.playoffs.title': 'Playoff Context',
  'page.current.playoffs.description':
    'Track alliance formation, likely bracket paths, and how the live field may unfold from here.',
  'page.current.event.eyebrow': 'Current / Event',
  'page.current.event.title': 'Event Context',
  'page.current.event.description':
    'Review the full event picture with teams, match status, and the supporting analytics behind the live state.',
  'page.current.data.eyebrow': 'Current / Data',
  'page.current.data.title': 'Data Super Tab',
  'page.current.data.description':
    'Dive into metrics, breakdown matrices, and chartable event data without losing analyst-grade density.',
  'page.historical.pre_event.eyebrow': 'Historical / Pre-Event',
  'page.historical.pre_event.title': 'Season Scouting',
  'page.historical.pre_event.description':
    'Review historical event, team, ranking, and playoff context through a season-wide scouting lens.',
  'page.historical.strategy.eyebrow': 'Historical / Strategy',
  'page.historical.strategy.title': 'Historical Strategy',
  'page.historical.strategy.description':
    'Revisit prior match plans, compare saved strategy boards, and learn from completed events.',
  'page.historical.district.eyebrow': 'Historical / District',
  'page.historical.district.title': 'Season District Outlook',
  'page.historical.district.description':
    'See cut lines, probability bands, and season-range outcomes for district advancement.',
  'page.historical.compare.eyebrow': 'Historical / Compare',
  'page.historical.compare.title': 'Season Team Comparison',
  'page.historical.compare.description':
    'Compare teams across season trends, match logs, and historical role fit with exact metrics.',
  'page.historical.team_profile.eyebrow': 'Historical / Team Profile',
  'page.historical.team_profile.title': 'Season Team Profile',
  'page.historical.team_profile.description':
    'Open a season-centric team profile with event history, breakdowns, and reference analytics.',
  'page.historical.rankings.eyebrow': 'Historical / Rankings',
  'page.historical.rankings.title': 'Historical Rankings',
  'page.historical.rankings.description':
    'Study prior ranking movement, event tables, and where teams actually landed after play was complete.',
  'page.historical.playoffs.eyebrow': 'Historical / Playoffs',
  'page.historical.playoffs.title': 'Historical Playoffs',
  'page.historical.playoffs.description':
    'Review alliance outcomes, bracket results, and the playoff picture from completed events.',
  'page.historical.event.eyebrow': 'Historical / Event',
  'page.historical.event.title': 'Historical Event Context',
  'page.historical.event.description':
    'Explore full prior-event context without disturbing the live-event workflow in Current.',
  'page.historical.data.eyebrow': 'Historical / Data',
  'page.historical.data.title': 'Historical Data Super Tab',
  'page.historical.data.description':
    'Analyze season and event history with the same dense metric tools used in live operations.',
  'page.predict.predict.eyebrow': 'Predict / Forecast',
  'page.predict.predict.title': 'Qualification Forecast',
  'page.predict.predict.description':
    'Run forecast scenarios, compare likely ranking movement, and see the live projection story clearly.',
  'page.predict.alliance.eyebrow': 'Predict / Alliance',
  'page.predict.alliance.title': 'Alliance Selection',
  'page.predict.alliance.description':
    'Model alliance creation, evaluate fit, and keep likely captain paths visible as the board changes.',
  'page.predict.playoff_lab.eyebrow': 'Predict / Playoff Lab',
  'page.predict.playoff_lab.title': 'Playoff Simulation Lab',
  'page.predict.playoff_lab.description':
    'Stress-test bracket outcomes, compare scenarios, and understand how matchup assumptions change the field.',
  'page.predict.impact.eyebrow': 'Predict / Impact',
  'page.predict.impact.title': 'Impact Simulator',
  'page.predict.impact.description':
    'See how different RP results and match outcomes change ranking pressure around our team.',
  'page.predict.pick_list.eyebrow': 'Predict / Pick Lists',
  'page.predict.pick_list.title': 'Pick Lists',
  'page.predict.pick_list.description':
    'Maintain role-aware shortlist views with comments, tags, and priority movement as the event evolves.',
  'page.predict.live_alliance.eyebrow': 'Predict / Live Alliance',
  'page.predict.live_alliance.title': 'Live Alliance Board',
  'page.predict.live_alliance.description':
    'Track live alliance selection in a purpose-built board without losing the wider strategic context.',
  'page.settings.settings.eyebrow': 'System / Settings',
  'page.settings.settings.title': 'Product Controls',
  'page.settings.settings.description':
    'Manage polling, diagnostics, branding assets, and raw payload inspection for troubleshooting and tuning.',
  'settings.section.preferences': 'Product Preferences',
  'settings.section.webhooks': 'Discord Webhooks',
  'settings.section.diagnostics': 'Diagnostics + Scenario Notes',
  'settings.section.preview': 'Semantic Color Preview',
  'settings.poll_ms': 'Poll Speed (milliseconds)',
  'settings.repeat_alert': 'Repeat alert sound until stopped',
  'settings.upload_logo': 'Upload Team Logo',
  'settings.open_explorer': 'Open Explorer',
  'settings.raw_payload_explorer': 'Raw Payload Explorer',
  'settings.theme.label': 'Theme',
  'settings.language.label': 'Language',
  'settings.language.en': 'English',
  'settings.language.es': 'Spanish',
  'settings.language.fr': 'French',
  'settings.theme.graphite_dark': 'Graphite Dark',
  'settings.theme.light_slate': 'Light Slate',
  'settings.theme.cyan_night': 'Cyan Night',
  'settings.webhook.enabled': 'Enable Discord webhook delivery',
  'settings.webhook.url': 'Discord Webhook URL',
  'settings.webhook.display_name': 'Display Name',
  'settings.webhook.cooldown': 'Cooldown (seconds)',
  'settings.webhook.test': 'Send Test',
  'settings.webhook.testing': 'Sending...',
  'settings.webhook.last_success': 'Last success: {{value}}',
  'settings.webhook.last_failure': 'Last failure: {{value}}',
  'settings.webhook.help':
    'Send important operational events to Discord without exposing the webhook URL directly from the browser.',
  'settings.webhook.event.queue_5': 'Queue 5',
  'settings.webhook.event.queue_2': 'Queue 2',
  'settings.webhook.event.queue_1': 'Queue 1',
  'settings.webhook.event.playing_now': 'Playing Now',
  'settings.webhook.event.mode_changed': 'Live / Offline mode changes',
  'settings.webhook.event.snapshot_failed': 'Snapshot load failures',
  'settings.webhook.event.snapshot_recovered': 'Snapshot recovery',
  'settings.webhook.event.manual_load_failed': 'Manual load failures',
  'settings.webhook.event.warning': 'Important warnings',
  'settings.webhook.event.test': 'Manual test sends',
  'settings.semantic.preview':
    'Use semantic color only when directionality is actually meaningful.',
  'settings.semantic.negative_strong': 'Strong negative',
  'settings.semantic.negative_mild': 'Mild negative',
  'settings.semantic.neutral': 'Neutral',
  'settings.semantic.positive_mild': 'Mild positive',
  'settings.semantic.positive_strong': 'Strong positive',
  'settings.snapshot_generated': 'Snapshot generated',
  'settings.event_teams': 'Event teams',
  'settings.matches': 'Matches',
  'settings.sb_matches': 'SB matches',
  'settings.sb_team_events': 'SB team events',
  'settings.notes.predict': 'PREDICT saves full projected ranking scenarios.',
  'settings.notes.alliance': 'ALLIANCE loads live or saved projected orders.',
  'settings.notes.playoff': 'PLAYOFF LAB compares alliance scenarios and manual winner choices.',
  'status.loading': 'Loading...',
  'status.live': 'Live',
  'status.offline': 'Offline',
  'status.syncing': 'Syncing',
  'status.waiting_first_load': 'Waiting for first load',
  'status.recompute': 'Recompute',
  'status.simulating': 'Simulating...',
  'template.overview': 'Overview',
  'template.reference': 'Reference',
  'template.workbench': 'Workbench',
  'field.team': 'Team',
  'field.event': 'Event',
  'field.day': 'Day',
  'field.updated': 'Updated',
  'field.load': 'Load',
  'field.audio': 'Audio',
  'field.audio_on': 'Audio On',
  'field.go_offline': 'Go Offline',
  'field.advance_match': '+1 Match',
  'field.poll': 'Poll {{value}}s',
  'webhook.test.title': 'Strategy Desk Test',
  'webhook.test.body': 'Manual webhook test from Strategy Desk.',
  'webhook.event.mode_changed.title': 'Mode changed',
  'webhook.event.snapshot_failed.title': 'Snapshot load failed',
  'webhook.event.snapshot_recovered.title': 'Snapshot load recovered',
  'webhook.event.manual_load_failed.title': 'Manual load failed',
  'webhook.event.warning.title': 'Important dashboard warning',
  'webhook.event.queue_5.title': 'Queue in 5 matches',
  'webhook.event.queue_2.title': 'Queue in 2 matches',
  'webhook.event.queue_1.title': 'Queue next',
  'webhook.event.playing_now.title': 'Playing now',
};

const ES_TRANSLATIONS: TranslationDictionary = {
  'clock.label': 'Hora local actual',
  'chart.empty.title': 'No hay datos de gráfico disponibles',
  'chart.empty.description':
    'Carga un conjunto de datos o cambia a un alcance que tenga valores graficables.',
  'game_manual.default_title': 'Manual del Juego FRC 2026',
  'game_manual.summary':
    'Manual oficial de FIRST integrado como lector con búsqueda dentro de la aplicación.',
  'game_manual.last_updated': 'Última actualización: {{value}}',
  'game_manual.open_html': 'Abrir HTML oficial',
  'game_manual.open_pdf': 'Abrir PDF oficial',
  'game_manual.search_placeholder': 'Buscar en el manual del juego 2026',
  'game_manual.search_results': 'Resultados de búsqueda',
  'game_manual.toc': 'Tabla de contenido',
  'game_manual.loading': 'Cargando manual del juego...',
  'game_manual.unavailable': 'Manual del juego no disponible',
  'game_manual.matching_sections': '{{count}} secciones coincidentes',
  'game_manual.sections_loaded': '{{count}} secciones cargadas',
  'game_manual.no_results':
    'Ninguna seccion coincide con tu busqueda. Prueba un termino mas amplio.',
  'raw_payload.route': 'Ruta DATA',
  'raw_payload.snapshot': 'Snapshot',
  'compare.add_teams': 'Agregar equipos',
  'compare.add_from_current_event': 'Agregar desde el evento actual',
  'compare.add_current_event_team': 'Agregar equipo del evento actual',
  'compare.baseline': 'Base',
  'compare.save_set': 'Guardar conjunto',
  'compare.load_saved_set': 'Cargar conjunto guardado',
  'compare.current_compare': 'Comparacion actual',
  'compare.historical_compare': 'Comparacion historica',
  'compare.loaded_event_title': 'Comparacion del evento cargado',
  'compare.historical_title': 'Comparacion historica 2026',
  'compare.loaded_event_description': 'Tabla y narrativas de comparacion solo del evento actual.',
  'compare.historical_description':
    'Tabla historica de comparacion usando datos de 2026 y excluyendo el evento cargado.',
  'compare.add_to_start': 'Agrega equipos para comenzar a comparar.',
  'compare.charts_description':
    'Graficos de metricas y distribuciones para el conjunto activo de comparacion.',
  'district.title': 'Puntos distritales',
  'district.load_fit_event':
    'Carga un evento distrital FIT para usar la suite de puntos distritales.',
  'district.current_title': 'Evento distrital actual',
  'district.historical_title': 'Temporada distrital historica',
  'district.summary':
    'Puntos distritales FIT construidos con datos oficiales de TBA y simulacion basada en EPA.',
  'district.runs': 'Corridas',
  'district.loading_snapshot': 'Cargando snapshot distrital...',
  'nav.major.current': 'ACTUAL',
  'nav.major.historical': 'HISTÓRICO',
  'nav.major.predict': 'PREDICCIÓN',
  'nav.major.settings': 'AJUSTES',
  'status.loading': 'Cargando...',
  'status.live': 'En vivo',
  'status.offline': 'Sin conexión',
  'status.syncing': 'Sincronizando',
  'status.waiting_first_load': 'Esperando la primera carga',
  'status.recompute': 'Recalcular',
  'status.simulating': 'Simulando...',
  'template.overview': 'Resumen',
  'template.reference': 'Referencia',
  'template.workbench': 'Mesa de trabajo',
  'field.team': 'Equipo',
  'field.event': 'Evento',
  'field.day': 'Día',
  'field.updated': 'Actualizado',
  'field.load': 'Cargar',
  'field.audio': 'Audio',
  'field.audio_on': 'Audio activado',
  'field.go_offline': 'Desconectar',
  'field.advance_match': '+1 Partido',
  'field.poll': 'Sondeo {{value}}s',
  'settings.section.preferences': 'Preferencias del producto',
  'settings.section.webhooks': 'Webhooks de Discord',
  'settings.section.diagnostics': 'Diagnóstico + notas de escenarios',
  'settings.section.preview': 'Vista previa del color semántico',
  'settings.poll_ms': 'Velocidad de sondeo (milisegundos)',
  'settings.repeat_alert': 'Repetir sonido de alerta hasta detenerlo',
  'settings.upload_logo': 'Subir logotipo del equipo',
  'settings.open_explorer': 'Abrir explorador',
  'settings.raw_payload_explorer': 'Explorador de payloads',
  'settings.theme.label': 'Tema',
  'settings.language.label': 'Idioma',
  'settings.language.en': 'Inglés',
  'settings.language.es': 'Español',
  'settings.language.fr': 'Francés',
  'settings.theme.graphite_dark': 'Grafito oscuro',
  'settings.theme.light_slate': 'Pizarra clara',
  'settings.theme.cyan_night': 'Noche cian',
  'settings.webhook.enabled': 'Habilitar entrega por webhook de Discord',
  'settings.webhook.url': 'URL del webhook de Discord',
  'settings.webhook.display_name': 'Nombre visible',
  'settings.webhook.cooldown': 'Enfriamiento (segundos)',
  'settings.webhook.test': 'Enviar prueba',
  'settings.webhook.testing': 'Enviando...',
  'settings.webhook.last_success': 'Último éxito: {{value}}',
  'settings.webhook.last_failure': 'Último fallo: {{value}}',
  'settings.webhook.help':
    'Envía eventos operativos importantes a Discord sin exponer la URL del webhook directamente desde el navegador.',
  'settings.webhook.event.queue_5': 'Fila en 5 partidos',
  'settings.webhook.event.queue_2': 'Fila en 2 partidos',
  'settings.webhook.event.queue_1': 'Fila siguiente',
  'settings.webhook.event.playing_now': 'Jugando ahora',
  'settings.webhook.event.mode_changed': 'Cambios de modo en vivo / sin conexión',
  'settings.webhook.event.snapshot_failed': 'Fallos de carga del snapshot',
  'settings.webhook.event.snapshot_recovered': 'Recuperación del snapshot',
  'settings.webhook.event.manual_load_failed': 'Fallos de carga manual',
  'settings.webhook.event.warning': 'Advertencias importantes',
  'settings.webhook.event.test': 'Envíos de prueba manuales',
  'settings.semantic.preview':
    'Usa color semántico solo cuando la dirección del valor realmente sea significativa.',
  'settings.semantic.negative_strong': 'Negativo fuerte',
  'settings.semantic.negative_mild': 'Negativo leve',
  'settings.semantic.neutral': 'Neutral',
  'settings.semantic.positive_mild': 'Positivo leve',
  'settings.semantic.positive_strong': 'Positivo fuerte',
  'settings.snapshot_generated': 'Snapshot generado',
  'settings.event_teams': 'Equipos del evento',
  'settings.matches': 'Partidos',
  'settings.sb_matches': 'Partidos SB',
  'settings.sb_team_events': 'Eventos de equipo SB',
  'settings.notes.predict': 'PREDICT guarda escenarios completos de clasificación proyectada.',
  'settings.notes.alliance': 'ALLIANCE carga órdenes en vivo o guardadas.',
  'settings.notes.playoff': 'PLAYOFF LAB compara escenarios de alianzas y ganadores manuales.',
  'webhook.test.title': 'Prueba de Strategy Desk',
  'webhook.test.body': 'Prueba manual de webhook desde Strategy Desk.',
  'webhook.event.mode_changed.title': 'Modo cambiado',
  'webhook.event.snapshot_failed.title': 'Falló la carga del snapshot',
  'webhook.event.snapshot_recovered.title': 'Se recuperó la carga del snapshot',
  'webhook.event.manual_load_failed.title': 'Falló la carga manual',
  'webhook.event.warning.title': 'Advertencia importante del dashboard',
  'webhook.event.queue_5.title': 'Fila en 5 partidos',
  'webhook.event.queue_2.title': 'Fila en 2 partidos',
  'webhook.event.queue_1.title': 'Fila siguiente',
  'webhook.event.playing_now.title': 'Jugando ahora',
};

const FR_TRANSLATIONS: TranslationDictionary = {
  'clock.label': 'Heure locale actuelle',
  'chart.empty.title': 'Aucune donnée de graphique disponible',
  'chart.empty.description':
    'Chargez un jeu de données ou passez à une portée contenant des valeurs exploitables.',
  'game_manual.default_title': 'Manuel du jeu FRC 2026',
  'game_manual.summary':
    "Manuel officiel FIRST intégré comme lecteur consultable dans l'application.",
  'game_manual.last_updated': 'Dernière mise à jour : {{value}}',
  'game_manual.open_html': 'Ouvrir le HTML officiel',
  'game_manual.open_pdf': 'Ouvrir le PDF officiel',
  'game_manual.search_placeholder': 'Rechercher dans le manuel du jeu 2026',
  'game_manual.search_results': 'Résultats de recherche',
  'game_manual.toc': 'Table des matières',
  'game_manual.loading': 'Chargement du manuel du jeu...',
  'game_manual.unavailable': 'Manuel du jeu indisponible',
  'game_manual.matching_sections': '{{count}} sections correspondantes',
  'game_manual.sections_loaded': '{{count}} sections chargées',
  'game_manual.no_results':
    'Aucune section du manuel ne correspond a votre recherche. Essayez un terme plus large.',
  'raw_payload.route': 'Route DATA',
  'raw_payload.snapshot': 'Snapshot',
  'compare.add_teams': 'Ajouter des equipes',
  'compare.add_from_current_event': "Ajouter depuis l'evenement actuel",
  'compare.add_current_event_team': "Ajouter une equipe de l'evenement actuel",
  'compare.baseline': 'Reference',
  'compare.save_set': "Enregistrer l'ensemble",
  'compare.load_saved_set': "Charger l'ensemble enregistre",
  'compare.current_compare': 'Comparaison actuelle',
  'compare.historical_compare': 'Comparaison historique',
  'compare.loaded_event_title': "Comparaison de l'evenement charge",
  'compare.historical_title': 'Comparaison historique 2026',
  'compare.loaded_event_description':
    "Tableau et commentaires de comparaison limites a l'evenement actuel.",
  'compare.historical_description':
    'Tableau historique de comparaison utilisant les donnees 2026 hors evenement charge.',
  'compare.add_to_start': 'Ajoutez des equipes pour commencer la comparaison.',
  'compare.charts_description':
    "Graphiques de metriques et de distributions pour l'ensemble de comparaison actif.",
  'district.title': 'Points de district',
  'district.load_fit_event':
    'Chargez un evenement FIT pour utiliser la suite des points de district.',
  'district.current_title': 'Evenement de district actuel',
  'district.historical_title': 'Saison de district historique',
  'district.summary':
    'Points FIT construits a partir des donnees officielles TBA et dune simulation basee sur EPA.',
  'district.runs': 'Iterations',
  'district.loading_snapshot': 'Chargement du snapshot de district...',
  'nav.major.current': 'ACTUEL',
  'nav.major.historical': 'HISTORIQUE',
  'nav.major.predict': 'PRÉDICTION',
  'nav.major.settings': 'RÉGLAGES',
  'status.loading': 'Chargement...',
  'status.live': 'En direct',
  'status.offline': 'Hors ligne',
  'status.syncing': 'Synchronisation',
  'status.waiting_first_load': 'En attente du premier chargement',
  'status.recompute': 'Recalculer',
  'status.simulating': 'Simulation...',
  'template.overview': 'Vue d ensemble',
  'template.reference': 'Reference',
  'template.workbench': 'Espace de travail',
  'field.team': 'Équipe',
  'field.event': 'Événement',
  'field.day': 'Jour',
  'field.updated': 'Mis a jour',
  'field.load': 'Charger',
  'field.audio': 'Audio',
  'field.audio_on': 'Audio activé',
  'field.go_offline': 'Passer hors ligne',
  'field.advance_match': '+1 Match',
  'field.poll': 'Scrutation {{value}}s',
  'settings.section.preferences': 'Préférences produit',
  'settings.section.webhooks': 'Webhooks Discord',
  'settings.section.diagnostics': 'Diagnostic + notes de scénario',
  'settings.section.preview': 'Aperçu des couleurs sémantiques',
  'settings.poll_ms': 'Vitesse de scrutation (millisecondes)',
  'settings.repeat_alert': "Répéter l'alerte sonore jusqu'à l'arrêt",
  'settings.upload_logo': "Téléverser le logo de l'équipe",
  'settings.open_explorer': "Ouvrir l'explorateur",
  'settings.raw_payload_explorer': 'Explorateur de payloads',
  'settings.theme.label': 'Thème',
  'settings.language.label': 'Langue',
  'settings.language.en': 'Anglais',
  'settings.language.es': 'Espagnol',
  'settings.language.fr': 'Français',
  'settings.theme.graphite_dark': 'Graphite sombre',
  'settings.theme.light_slate': 'Ardoise claire',
  'settings.theme.cyan_night': 'Nuit cyan',
  'settings.webhook.enabled': "Activer l'envoi via webhook Discord",
  'settings.webhook.url': 'URL du webhook Discord',
  'settings.webhook.display_name': "Nom d'affichage",
  'settings.webhook.cooldown': 'Délai anti-duplication (secondes)',
  'settings.webhook.test': 'Envoyer un test',
  'settings.webhook.testing': 'Envoi...',
  'settings.webhook.last_success': 'Dernier succès : {{value}}',
  'settings.webhook.last_failure': 'Dernier échec : {{value}}',
  'settings.webhook.help':
    "Envoie les événements opérationnels importants vers Discord sans exposer directement l'URL du webhook depuis le navigateur.",
  'settings.webhook.event.queue_5': 'File dans 5 matchs',
  'settings.webhook.event.queue_2': 'File dans 2 matchs',
  'settings.webhook.event.queue_1': 'File au prochain match',
  'settings.webhook.event.playing_now': 'En jeu maintenant',
  'settings.webhook.event.mode_changed': 'Changements de mode direct / hors ligne',
  'settings.webhook.event.snapshot_failed': 'Échecs de chargement du snapshot',
  'settings.webhook.event.snapshot_recovered': 'Récupération du snapshot',
  'settings.webhook.event.manual_load_failed': 'Échecs de chargement manuel',
  'settings.webhook.event.warning': 'Avertissements importants',
  'settings.webhook.event.test': 'Tests manuels',
  'settings.semantic.preview':
    'Utiliser la couleur sémantique uniquement lorsque la direction de la valeur est réellement significative.',
  'settings.semantic.negative_strong': 'Négatif fort',
  'settings.semantic.negative_mild': 'Négatif léger',
  'settings.semantic.neutral': 'Neutre',
  'settings.semantic.positive_mild': 'Positif léger',
  'settings.semantic.positive_strong': 'Positif fort',
  'settings.snapshot_generated': 'Snapshot généré',
  'settings.event_teams': "Équipes de l'événement",
  'settings.matches': 'Matchs',
  'settings.sb_matches': 'Matchs SB',
  'settings.sb_team_events': "Événements d'équipe SB",
  'settings.notes.predict': 'PREDICT enregistre les scénarios complets de classement projeté.',
  'settings.notes.alliance': 'ALLIANCE charge des ordres en direct ou enregistrés.',
  'settings.notes.playoff':
    'PLAYOFF LAB compare les scénarios d’alliances et les vainqueurs manuels.',
  'webhook.test.title': 'Test Strategy Desk',
  'webhook.test.body': 'Test manuel de webhook depuis Strategy Desk.',
  'webhook.event.mode_changed.title': 'Mode modifié',
  'webhook.event.snapshot_failed.title': 'Échec du chargement du snapshot',
  'webhook.event.snapshot_recovered.title': 'Chargement du snapshot rétabli',
  'webhook.event.manual_load_failed.title': 'Échec du chargement manuel',
  'webhook.event.warning.title': 'Avertissement important du tableau de bord',
  'webhook.event.queue_5.title': 'File dans 5 matchs',
  'webhook.event.queue_2.title': 'File dans 2 matchs',
  'webhook.event.queue_1.title': 'File au prochain match',
  'webhook.event.playing_now.title': 'En jeu maintenant',
};

const TRANSLATIONS: Record<LanguageCode, TranslationDictionary> = {
  en: EN_TRANSLATIONS,
  es: {
    ...EN_TRANSLATIONS,
    ...ES_TRANSLATIONS,
  },
  fr: {
    ...EN_TRANSLATIONS,
    ...FR_TRANSLATIONS,
  },
};

function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    return value == null ? '' : String(value);
  });
}

export function getLocaleForLanguage(language: LanguageCode): string {
  return LANGUAGE_LOCALES[language] ?? LANGUAGE_LOCALES.en;
}

export function translate(
  language: LanguageCode,
  key: string,
  fallback?: string,
  vars?: TranslateVars,
): string {
  const template = TRANSLATIONS[language]?.[key] ?? TRANSLATIONS.en[key] ?? fallback ?? key;
  return interpolate(template, vars);
}

export function normalizeTranslationKey(value: string): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w/.-]+/g, '_');
}

export function formatLocalizedDateTime(
  value: Date | string | number,
  language: LanguageCode,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(getLocaleForLanguage(language), options).format(date);
}

export function formatLocalizedNumber(
  value: number | null | undefined,
  language: LanguageCode,
  options?: Intl.NumberFormatOptions,
): string {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return new Intl.NumberFormat(getLocaleForLanguage(language), options).format(Number(value));
}

export function formatLocalizedPercent(
  value: number | null | undefined,
  language: LanguageCode,
  digits = 1,
): string {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return new Intl.NumberFormat(getLocaleForLanguage(language), {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value));
}

export function formatLocalizedCompactNumber(
  value: number | null | undefined,
  language: LanguageCode,
): string {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return new Intl.NumberFormat(getLocaleForLanguage(language), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(value));
}

export function semanticToneClass(tone: SemanticTone): string {
  return `tone-${tone}`;
}

export function getSemanticToneFromDelta(
  delta: number | null | undefined,
  direction: AnalyticsSemanticDirection = 'neutral',
): SemanticTone {
  if (delta == null || !Number.isFinite(Number(delta)) || direction === 'neutral') return 'neutral';
  const normalized = direction === 'positive_when_lower' ? -Number(delta) : Number(delta);
  if (normalized >= 5) return 'positive-strong';
  if (normalized > 0) return 'positive-mild';
  if (normalized <= -5) return 'negative-strong';
  if (normalized < 0) return 'negative-mild';
  return 'neutral';
}

export function getSemanticToneForProbability(value: number | null | undefined): SemanticTone {
  if (value == null || !Number.isFinite(Number(value))) return 'neutral';
  const probability = Number(value);
  if (probability >= 0.95) return 'positive-strong';
  if (probability >= 0.6) return 'positive-mild';
  if (probability <= 0.05) return 'negative-strong';
  if (probability < 0.4) return 'negative-mild';
  return 'neutral';
}

export function getSemanticToneForStatus(status: string | null | undefined): SemanticTone {
  if (status === 'AUTO' || status === 'LOCKED') return 'positive-strong';
  if (status === 'ELIMINATED') return 'negative-strong';
  if (status === 'BUBBLE') return 'negative-mild';
  return 'neutral';
}
