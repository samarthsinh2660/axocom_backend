import { ApolloServer } from '@apollo/server';
import type { GraphQLContext } from '../../src/graphql/context';
import type { TokenData } from '../../src/utils/jwt';

// Loaded for every test file, so nothing here may import the app eagerly:
// graphql.loader pulls in dataconfig/db, which opens a MySQL pool at module
// scope and hangs the suite when the database is unreachable. Imported lazily
// inside the helpers instead.

// Create a test server for integration tests
export function createTestServer() {
    const { buildGraphQL } = require('../../src/graphql/loaders/graphql.loader');
    const { typeDefs, resolvers } = buildGraphQL();
    return new ApolloServer<GraphQLContext>({
        typeDefs,
        resolvers,
    });
}

// Create a test context for integration tests
export function createContext(overrides: { user?: TokenData | null; req?: any } = {}) {
    const { createLoaders } = require('../../src/graphql/loaders/dataloader');
    const { user = { id: 1, is_admin: false, email: 'test@example.com' }, req = {} } = overrides;
    return { req, user, loaders: createLoaders() } as GraphQLContext;
}

// Clean up console warnings during tests
global.console = {
    ...console,
    error: jest.fn(),
    warn: jest.fn(),
};

// Set default test timeout
jest.setTimeout(10000);