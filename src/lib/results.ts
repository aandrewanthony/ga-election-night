// Georgia Secretary of State live results (results.sos.ga.gov, Enhanced Voting). Public JSON, no key,
// no CORS headers: the desktop shell allows the request; the web build goes through a Netlify function.
import { isDesktop } from './desktop';

const SOS = 'https://results.sos.ga.gov/results/public/api';
export const SOS_PAGE = 'https://results.sos.ga.gov/results/public/Georgia/elections/';
export const ELECTION_DAY = '2026-11-03';

function apiUrl(path: string) {
  return isDesktop() || location.protocol === 'file:' ? `${SOS}/${path}` : `/.netlify/functions/ga-results?path=${encodeURIComponent(path)}`;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(apiUrl(path), { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 404 ? 'Not published yet' : `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

type Txt = { languageId: string; text: string }[];
const en = (t?: Txt | null) => t?.find((x) => x.languageId === 'en')?.text ?? t?.[0]?.text ?? '';

export interface ElectionRef { id: string; date: string; name: string }

export async function listElections(signal?: AbortSignal): Promise<ElectionRef[]> {
  const j = await getJson<{ elections: { publicElectionId: string; electionDate: string; name: Txt }[] }>('jurisdictions/Georgia', signal);
  return (j.elections ?? [])
    .map((e) => ({ id: e.publicElectionId, date: e.electionDate.slice(0, 10), name: en(e.name) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Election night's results once the state posts them; until then the most recent election. */
export function pickElection(list: ElectionRef[]): ElectionRef | undefined {
  return list.find((e) => e.date === ELECTION_DAY) ?? list[0];
}

export interface Option {
  name: string;
  party: string;
  incumbent: boolean;
  color: string;
  votes: number;
  winner: boolean;
}
export interface Race {
  id: string;
  name: string;
  /** Race name without the "- Rep" / "- Dem" primary suffix or translation. */
  title: string;
  category: Category;
  reporting: number;
  total: number;
  votes: number;
  close: boolean;
  asOf?: string;
  options: Option[];
}
export type Category = 'featured' | 'statewide' | 'house' | 'questions' | 'legislature' | 'local';
export const CATEGORY_LABEL: Record<Category, string> = {
  featured: 'Top races', statewide: 'Statewide', house: 'US House', questions: 'Ballot questions', legislature: 'Legislature', local: 'Other',
};

export interface Results {
  election: { name: string; date: string; official: boolean; lastUpdated?: string };
  races: Race[];
  fetchedAt: number;
}

const PARTY_COLOR: Record<string, string> = { REP: '#e0473e', DEM: '#3b82f6', LIB: '#e2b33c', GRN: '#3fa34d', IND: '#9aa4b2', NP: '#9aa4b2' };

function categorize(title: string, type: string): Category {
  const t = title.toLowerCase();
  if (/^us senate|^governor\b|^president/.test(t)) return 'featured';
  if (type !== 'Candidate' || /amendment|referendum|question|proposal|homestead|sunday sales|\bshall\b/.test(t)) return 'questions';
  if (/^us house/.test(t)) return 'house';
  if (/^(lieutenant governor|secretary of state|attorney general|commissioner of|state school superintendent|psc)/.test(t)) return 'statewide';
  if (/^(state senate|state house|special state senate|special state house)/.test(t)) return 'legislature';
  return 'local';
}

const cleanTitle = (n: string) => n.split('/')[0].replace(/\s+-\s+(Rep|Dem|Lib|NP)$/i, '').trim().replace(/\s+-\s*$/, '');

interface RawOption { name: Txt; voteCount: number; party?: { abbreviation?: string; color?: string | null } | null; isWinner?: boolean | null; isWriteIn?: boolean }
interface RawItem {
  id: string; name: Txt; contestType: string; voteTotal: number; isCloseRace?: boolean;
  reportingStatus?: { reportingUnits: number; totalUnits: number; asOf?: string } | null;
  summaryResults?: { ballotOptions: RawOption[] } | null;
}

export function parseRace(b: RawItem): Race {
  const name = en(b.name);
  const title = cleanTitle(name);
  const options = (b.summaryResults?.ballotOptions ?? []).map((o): Option => {
    let n = en(o.name);
    let party = (o.party?.abbreviation ?? '').toUpperCase();
    const m = /\s*\((Rep|Dem|Lib|Grn|Ind|NP)\)\s*$/i.exec(n);
    if (m) { party ||= m[1].toUpperCase(); n = n.slice(0, m.index); }
    const incumbent = /\(I\)/.test(n);
    n = n.replace(/\s*\(I\)\s*/g, ' ').trim();
    return { name: n, party, incumbent, color: PARTY_COLOR[party] || o.party?.color || '#8b93a1', votes: o.voteCount ?? 0, winner: !!o.isWinner };
  }).sort((a, b) => b.votes - a.votes);
  return {
    id: b.id, name, title, category: categorize(title, b.contestType),
    reporting: b.reportingStatus?.reportingUnits ?? 0, total: b.reportingStatus?.totalUnits ?? 0,
    votes: b.voteTotal ?? options.reduce((s, o) => s + o.votes, 0), close: !!b.isCloseRace, asOf: b.reportingStatus?.asOf, options,
  };
}

interface RawData {
  election: { name: Txt; electionDate: string; isOfficialResults?: boolean; lastUpdated?: string };
  ballotItems: RawItem[];
}

export async function fetchResults(jurisdiction: string, electionId: string, signal?: AbortSignal): Promise<Results> {
  const d = await getJson<RawData>(`elections/${jurisdiction}/${electionId}/data`, signal);
  return {
    election: { name: en(d.election?.name), date: d.election?.electionDate?.slice(0, 10) ?? '', official: !!d.election?.isOfficialResults, lastUpdated: d.election?.lastUpdated },
    races: (d.ballotItems ?? []).map(parseRace),
    fetchedAt: Date.now(),
  };
}

/** The core metro Atlanta counties, for the county breakdown of the top races. */
export const METRO = [
  { id: 'fulton-county-ga', name: 'Fulton' },
  { id: 'dekalb-county-ga', name: 'DeKalb' },
  { id: 'cobb-county-ga', name: 'Cobb' },
  { id: 'gwinnett-county-ga', name: 'Gwinnett' },
  { id: 'clayton-county-ga', name: 'Clayton' },
];

export const pct = (v: number, total: number) => (total > 0 ? (100 * v) / total : 0);
export const fmt = (n: number) => n.toLocaleString('en-US');
