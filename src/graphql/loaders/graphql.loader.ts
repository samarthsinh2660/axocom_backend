import { readFileSync } from "fs";
import { join } from "path";
import { loadFilesSync } from "@graphql-tools/load-files";
import { mergeTypeDefs, mergeResolvers } from "@graphql-tools/merge";
import { candidateResolvers } from "../resolvers/candidate.resolver";
import { voterResolvers } from "../resolvers/voter.resolver";
import { authResolvers } from '../resolvers/auth.resolver';
import { partyResolvers } from "../resolvers/party.resolver";
import { electionResolvers } from "../resolvers/election.resolver";
import { constituencyResolvers } from "../resolvers/constituency.resolver";
import { electionCandidateResolvers } from "../resolvers/election_candidate.resolver";
import { electionResultResolvers } from "../resolvers/election_result.resolver";
import { flagResolvers } from "../resolvers/flag.resolver";
import { mentorResolvers } from "../resolvers/mentor.resolver";
import { solutionResolvers } from "../resolvers/solution.resolver";

const schemaPath = join(process.cwd(), "src/graphql/schema");

export function buildGraphQL() {
    const typeDefsArray = loadFilesSync(schemaPath, {
        extensions: ["gql", "graphql"],
        recursive: true,
        requireMethod: (path: string) => readFileSync(path, "utf-8"),
    });

    const typeDefs = mergeTypeDefs(typeDefsArray);
    const resolvers = mergeResolvers([
        candidateResolvers,
        voterResolvers,
        authResolvers,
        partyResolvers,
        electionResolvers,
        constituencyResolvers,
        electionCandidateResolvers,
        electionResultResolvers,
        flagResolvers,
        mentorResolvers,
        solutionResolvers,
    ]);

    return { typeDefs, resolvers };
}