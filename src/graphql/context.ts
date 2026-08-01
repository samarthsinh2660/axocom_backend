import { GraphQLError } from 'graphql';
import type { Request } from 'express';
import type { TokenData } from '../utils/jwt';
import type { Loaders } from './loaders/dataloader';

export interface GraphQLContext {
    req: Request;
    user: TokenData | null;
    loaders: Loaders;
}

export function requireAuth(context: GraphQLContext): TokenData {
    if (!context.user) {
        throw new GraphQLError('Unauthorized', {
            extensions: { code: 'UNAUTHORIZED', statusCode: 401, errorCode: 20005 },
        });
    }
    return context.user;
}

export function requireAdmin(context: GraphQLContext): TokenData {
    const user = requireAuth(context);
    if (!user.is_admin) {
        throw new GraphQLError('Admin access required', {
            extensions: { code: 'FORBIDDEN', statusCode: 403, errorCode: 20007 },
        });
    }
    return user;
}

export function toGraphQLError(error: { message: string; code: number; statusCode: number }): GraphQLError {
    const code = error.statusCode === 401
        ? 'UNAUTHORIZED'
        : error.statusCode === 403
            ? 'FORBIDDEN'
            : error.statusCode === 404
                ? 'NOT_FOUND'
                : error.statusCode === 409
                    ? 'CONFLICT'
                    : error.statusCode === 400
                        ? 'BAD_USER_INPUT'
                        : 'INTERNAL_SERVER_ERROR';

    return new GraphQLError(error.message, {
        extensions: { code, statusCode: error.statusCode, errorCode: error.code },
    });
}