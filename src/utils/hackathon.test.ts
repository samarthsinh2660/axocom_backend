import { describe, expect, it } from "@jest/globals";
import { GraphQLError } from "graphql";
import { requireAdmin, toGraphQLError, type GraphQLContext } from "../graphql/context";
import { isDuplicateKeyError, RequestError } from "./error";
import { isValidNormalizedPhone, normalizeEmail, normalizePhone } from "./normalize";

function contextFor(user: GraphQLContext["user"]): GraphQLContext {
    return { req: {} as GraphQLContext["req"], user, loaders: {} as GraphQLContext["loaders"] };
}

describe("hackathon validation", () => {
    it("normalizes equivalent Indian phone and email identities", () => {
        expect(normalizeEmail("  Person@Example.COM ")).toBe("person@example.com");
        expect(normalizePhone("+91 98765-43210")).toBe("9876543210");
        expect(isValidNormalizedPhone(normalizePhone("9876543210"))).toBe(true);
        expect(isValidNormalizedPhone(normalizePhone("12345"))).toBe(false);
    });

    it("recognizes MySQL duplicate-key errors", () => {
        expect(isDuplicateKeyError({ code: "ER_DUP_ENTRY" })).toBe(true);
        expect(isDuplicateKeyError({ errno: 1062 })).toBe(true);
        expect(isDuplicateKeyError(new Error("Duplicate entry 'x'"))).toBe(true);
        expect(isDuplicateKeyError(new Error("connection refused"))).toBe(false);
    });
});

describe("hackathon admin authorization", () => {
    it("returns an authenticated admin identity", () => {
        const admin = { id: 7, is_admin: true, email: "admin@example.com" };
        expect(requireAdmin(contextFor(admin))).toEqual(admin);
    });

    it("rejects non-admin users", () => {
        expect(() => requireAdmin(contextFor({ id: 8, is_admin: false }))).toThrow(GraphQLError);
    });

    it("maps repository conflicts to GraphQL conflicts", () => {
        const mapped = toGraphQLError(new RequestError("Duplicate", 60001, 409));
        expect(mapped.extensions).toMatchObject({
            code: "CONFLICT",
            statusCode: 409,
            errorCode: 60001,
        });
    });
});