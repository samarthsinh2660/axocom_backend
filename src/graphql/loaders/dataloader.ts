import DataLoader from "dataloader";
import { db } from "../../dataconfig/db";
import { Candidate, CANDIDATE_TABLE } from "../../models/candidate.model";
import { Party, PARTY_TABLE } from "../../models/party.model";
import { ELECTION_CANDIDATE_TABLE, ElectionCandidate } from "../../models/election_candidate.model";
import { Constituency, CONSTITUENCY_TABLE } from "../../models/constituency.model";
import { MENTOR_APPLICATIONS_TABLE, MentorApplicationRow } from "../../models/mentor.model";
import { SOLUTION_SUBMISSIONS_TABLE, SolutionSubmissionRow } from "../../models/solution.model";

// Batch function: given an array of IDs, return rows in the SAME order
async function batchCandidates(ids: readonly number[]): Promise<(Candidate | null)[]> {
    const [rows] = await db.execute<Candidate[]>(
        `SELECT * FROM ${CANDIDATE_TABLE} WHERE id IN (${ids.map(() => "?").join(",")})`,
        [...ids]
    );
    const map = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => map.get(id) ?? null);
}

async function batchParties(ids: readonly number[]): Promise<(Party | null)[]> {
    const [rows] = await db.execute<Party[]>(
        `SELECT * FROM ${PARTY_TABLE} WHERE id IN (${ids.map(() => "?").join(",")})`,
        [...ids]
    );
    const map = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => map.get(id) ?? null);
}

async function batchElectionCandidates(ids: readonly number[]): Promise<(ElectionCandidate | null)[]> {
    const [rows] = await db.execute<ElectionCandidate[]>(
        `SELECT * FROM ${ELECTION_CANDIDATE_TABLE} WHERE id IN (${ids.map(() => "?").join(",")})`,
        [...ids]
    );
    const map = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => map.get(id) ?? null);
}

async function batchConstituencies(ids: readonly number[]): Promise<(Constituency | null)[]> {
    const [rows] = await db.execute<Constituency[]>(
        `SELECT * FROM ${CONSTITUENCY_TABLE} WHERE id IN (${ids.map(() => "?").join(",")})`,
        [...ids]
    );
    const map = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => map.get(id) ?? null);
}

async function batchSolutions(ids: readonly string[]): Promise<(SolutionSubmissionRow | null)[]> {
    const [rows] = await db.execute<SolutionSubmissionRow[]>(
        `SELECT * FROM ${SOLUTION_SUBMISSIONS_TABLE} WHERE id IN (${ids.map(() => "?").join(",")})`,
        [...ids]
    );
    const map = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => map.get(id) ?? null);
}

async function batchMentors(ids: readonly string[]): Promise<(MentorApplicationRow | null)[]> {
    const [rows] = await db.execute<MentorApplicationRow[]>(
        `SELECT * FROM ${MENTOR_APPLICATIONS_TABLE} WHERE id IN (${ids.map(() => "?").join(",")})`,
        [...ids]
    );
    const map = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => map.get(id) ?? null);
}

// Factory — creates fresh loaders per request (important for cache isolation)
export function createLoaders() {
    return {
        candidateLoader: new DataLoader(batchCandidates),
        partyLoader: new DataLoader(batchParties),
        electionCandidateLoader: new DataLoader(batchElectionCandidates),
        constituencyLoader: new DataLoader(batchConstituencies),
        solutionById: new DataLoader(batchSolutions),
        mentorById: new DataLoader(batchMentors),
    };
}

export type Loaders = ReturnType<typeof createLoaders>;