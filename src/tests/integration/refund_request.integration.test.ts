import { ApolloServer } from '@apollo/server';
import { createTestServer, createContext } from '../setup';
import { ok, err } from 'neverthrow';
import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { refundRequestRepository } from '../../repositories/refund_request.repository';
import type { RefundRequestRow, RefundRequestMessageRow } from '../../models/refund_request.model';
import { ERRORS } from '../../utils/error';
import type { GraphQLContext } from '../../graphql/context';
import type { TokenData } from '../../utils/jwt';

const CREATE = `
  mutation CreateRefundRequest($input: CreateRefundRequestInput!) {
    createRefundRequest(input: $input) { ticketId status }
  }
`;

const TICKET = `
  query RefundTicket($ticketId: ID!, $email: String!) {
    refundTicket(ticketId: $ticketId, email: $email) {
      id requestType fullName registrationType registrationId
      paymentReference status createdAt resolvedAt
      messages { id author message createdAt }
    }
  }
`;

const REPLY_AS_USER = `
  mutation ReplyToRefundTicket($ticketId: ID!, $email: String!, $message: String!) {
    replyToRefundTicket(ticketId: $ticketId, email: $email, message: $message) {
      id author message
    }
  }
`;

const ADMIN_LIST = `
  query AdminRefundRequests($status: RefundStatus, $requestType: SupportRequestType, $registrationType: RegistrationType, $search: String) {
    adminRefundRequests(status: $status, requestType: $requestType, registrationType: $registrationType, search: $search) {
      data { id requestType fullName email phone registrationType registrationId reason status }
      pagination { total }
    }
  }
`;

const ADMIN_REPLY = `
  mutation ReplyToRefundRequest($id: ID!, $message: String!) {
    replyToRefundRequest(id: $id, message: $message) { id author message }
  }
`;

const UPDATE_STATUS = `
  mutation UpdateRefundRequestStatus($id: ID!, $status: RefundStatus!) {
    updateRefundRequestStatus(id: $id, status: $status)
  }
`;

const admin: TokenData = { id: 42, is_admin: true, email: 'admin@example.com' };
const nonAdmin: TokenData = { id: 2, is_admin: false, email: 'user@example.com' };

const createdAt = new Date('2026-01-01');

const ticketRow = (over: Record<string, unknown> = {}) => ({
    id: 'rfd_1',
    request_type: 'refund',
    full_name: 'Asha Menon',
    email: 'asha@example.com',
    normalized_email: 'asha@example.com',
    phone: '9876543210',
    normalized_phone: '9876543210',
    registration_type: 'delegate_pass',
    registration_id: 'dlg_1',
    payment_reference: 'pay_1',
    reason: 'Cannot attend',
    status: 'open',
    resolved_at: null,
    reviewed_by_admin_id: null,
    created_at: createdAt,
    updated_at: createdAt,
    ...over,
}) as RefundRequestRow;

const messageRow = (over: Record<string, unknown> = {}) => ({
    id: 'rmsg_1',
    refund_request_id: 'rfd_1',
    author: 'user',
    author_admin_id: null,
    message: 'Cannot attend',
    created_at: createdAt,
    ...over,
}) as RefundRequestMessageRow;

const validInput = {
    fullName: 'Asha Menon',
    email: 'asha@example.com',
    phone: '9876543210',
    registrationType: 'delegate_pass',
    registrationId: 'dlg_1',
    reason: 'Cannot attend the summit.',
};

function single(response: any) {
    expect(response.body.kind).toBe('single');
    return response.body.singleResult;
}

describe('Support request integration(schema + resolvers)', () => {
    let server: ApolloServer<GraphQLContext>;

    beforeAll(async () => {
        server = createTestServer();
        await server.start();
    });

    beforeEach(() => {
    // restoreAllMocks, not clearAllMocks: these suites assert that a repository
    // was NOT called, which only holds if the real method is put back between
    // tests rather than left mocked with its calls zeroed.
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        await server.stop();
    });

    describe('Mutation.createRefundRequest', () => {
        it('files a ticket without a session', async () => {
            jest.spyOn(refundRequestRepository, 'create')
                .mockResolvedValue(ok({ ticketId: 'rfd_1', status: 'open' }));

            const { data, errors } = single(await server.executeOperation(
                { query: CREATE, variables: { input: validInput } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors).toBeUndefined();
            expect(data?.createRefundRequest).toEqual({ ticketId: 'rfd_1', status: 'open' });
        });

        it.each(['refund', 'payment_not_reflected', 'other'])(
            'accepts request type %s',
            async (requestType) => {
                const spy = jest.spyOn(refundRequestRepository, 'create')
                    .mockResolvedValue(ok({ ticketId: 'rfd_1', status: 'open' }));

                const { errors } = single(await server.executeOperation(
                    { query: CREATE, variables: { input: { ...validInput, requestType } } },
                    { contextValue: createContext({ user: null }) }
                ));

                expect(errors).toBeUndefined();
                expect((spy.mock.calls[0][0] as any).requestType).toBe(requestType);
            }
        );

        it('defaults the request type when omitted, so an older client works', async () => {
            const spy = jest.spyOn(refundRequestRepository, 'create')
                .mockResolvedValue(ok({ ticketId: 'rfd_1', status: 'open' }));

            const { errors } = single(await server.executeOperation(
                { query: CREATE, variables: { input: validInput } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors).toBeUndefined();
            expect((spy.mock.calls[0][0] as any).requestType).toBeUndefined();
        });

        it('rejects a request type outside the enum', async () => {
            const spy = jest.spyOn(refundRequestRepository, 'create');

            const { errors } = single(await server.executeOperation(
                { query: CREATE, variables: { input: { ...validInput, requestType: 'chargeback' } } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors?.[0].extensions?.code).toBe('BAD_USER_INPUT');
            expect(spy).not.toHaveBeenCalled();
        });

        it.each([
            ['a missing reference', ERRORS.REFUND_REGISTRATION_REQUIRED, 80006],
            ['a reference that is not theirs', ERRORS.REFUND_REGISTRATION_MISMATCH, 80007],
            ['a blank reason', ERRORS.REFUND_REASON_REQUIRED, 80004],
        ])('surfaces %s', async (_n, error, code) => {
            jest.spyOn(refundRequestRepository, 'create').mockResolvedValue(err(error));

            const { errors } = single(await server.executeOperation(
                { query: CREATE, variables: { input: validInput } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors?.[0].extensions?.errorCode).toBe(code);
        });
    });

    describe('Query.refundTicket', () => {
        it('returns the ticket and its thread for the matching email', async () => {
            jest.spyOn(refundRequestRepository, 'getByTicketAndEmail').mockResolvedValue(ok(ticketRow()));
            jest.spyOn(refundRequestRepository, 'listMessages').mockResolvedValue(ok([
                messageRow(),
                messageRow({ id: 'rmsg_2', author: 'admin', message: 'Approved.' }),
            ]));

            const { data, errors } = single(await server.executeOperation(
                { query: TICKET, variables: { ticketId: 'rfd_1', email: 'asha@example.com' } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors).toBeUndefined();
            expect(data?.refundTicket).toMatchObject({
                id: 'rfd_1', requestType: 'refund', status: 'open',
            });
            expect(data?.refundTicket.messages).toHaveLength(2);
            expect(data?.refundTicket.messages[1].author).toBe('admin');
        });

        /** The public view must not carry contact details or reviewer fields. */
        it('does not expose email, phone, reason or reviewer on the public view', async () => {
            jest.spyOn(refundRequestRepository, 'getByTicketAndEmail').mockResolvedValue(ok(ticketRow()));
            jest.spyOn(refundRequestRepository, 'listMessages').mockResolvedValue(ok([]));

            const { errors } = single(await server.executeOperation(
                {
                    query: `query { refundTicket(ticketId: "rfd_1", email: "asha@example.com") { id email } }`,
                },
                { contextValue: createContext({ user: null }) }
            ));

            // The field does not exist on the public type at all.
            expect(errors?.[0].message).toMatch(/Cannot query field "email"/);
        });

        it('returns not found for a mismatched email', async () => {
            jest.spyOn(refundRequestRepository, 'getByTicketAndEmail')
                .mockResolvedValue(err(ERRORS.REFUND_REQUEST_NOT_FOUND));

            const { errors } = single(await server.executeOperation(
                { query: TICKET, variables: { ticketId: 'rfd_1', email: 'attacker@evil.com' } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors?.[0].extensions?.errorCode).toBe(80001);
        });
    });

    describe('Mutation.replyToRefundTicket', () => {
        it('re-verifies ticket and email before accepting the reply', async () => {
            const lookup = jest.spyOn(refundRequestRepository, 'getByTicketAndEmail')
                .mockResolvedValue(ok(ticketRow()));
            const add = jest.spyOn(refundRequestRepository, 'addMessage')
                .mockResolvedValue(ok(messageRow({ message: 'Thanks' })));

            const { data, errors } = single(await server.executeOperation(
                {
                    query: REPLY_AS_USER,
                    variables: { ticketId: 'rfd_1', email: 'asha@example.com', message: 'Thanks' },
                },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors).toBeUndefined();
            expect(data?.replyToRefundTicket.author).toBe('user');
            expect(lookup).toHaveBeenCalledWith('rfd_1', 'asha@example.com');
            expect(add).toHaveBeenCalledWith('rfd_1', 'user', 'Thanks', null);
        });

        it('refuses a reply when the email does not match', async () => {
            jest.spyOn(refundRequestRepository, 'getByTicketAndEmail')
                .mockResolvedValue(err(ERRORS.REFUND_REQUEST_NOT_FOUND));
            const add = jest.spyOn(refundRequestRepository, 'addMessage');

            const { errors } = single(await server.executeOperation(
                {
                    query: REPLY_AS_USER,
                    variables: { ticketId: 'rfd_1', email: 'attacker@evil.com', message: 'Refund me' },
                },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors).toHaveLength(1);
            expect(add).not.toHaveBeenCalled();
        });
    });

    describe('Query.adminRefundRequests', () => {
        it('returns the full record including contact details', async () => {
            jest.spyOn(refundRequestRepository, 'listAdmin').mockResolvedValue(ok({
                data: [ticketRow()],
                pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
            }));
            jest.spyOn(refundRequestRepository, 'listMessages').mockResolvedValue(ok([]));

            const { data, errors } = single(await server.executeOperation(
                { query: ADMIN_LIST, variables: {} },
                { contextValue: createContext({ user: admin }) }
            ));

            expect(errors).toBeUndefined();
            expect(data?.adminRefundRequests.data[0]).toMatchObject({
                id: 'rfd_1', requestType: 'refund', email: 'asha@example.com',
                phone: '9876543210', reason: 'Cannot attend',
            });
        });

        it('passes all three filters through', async () => {
            const spy = jest.spyOn(refundRequestRepository, 'listAdmin').mockResolvedValue(ok({
                data: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 1 },
            }));

            await server.executeOperation(
                {
                    query: ADMIN_LIST,
                    variables: {
                        status: 'open', requestType: 'payment_not_reflected',
                        registrationType: 'nomination', search: 'asha',
                    },
                },
                { contextValue: createContext({ user: admin }) }
            );

            expect(spy.mock.calls[0][0]).toMatchObject({
                status: 'open', requestType: 'payment_not_reflected',
                registrationType: 'nomination', search: 'asha',
            });
        });

        it.each([
            ['anonymous', null, 'UNAUTHORIZED'],
            ['non-admin', nonAdmin, 'FORBIDDEN'],
        ])('blocks a %s caller', async (_n, user, code) => {
            const spy = jest.spyOn(refundRequestRepository, 'listAdmin');

            const { errors } = single(await server.executeOperation(
                { query: ADMIN_LIST, variables: {} },
                { contextValue: createContext({ user: user as TokenData | null }) }
            ));

            expect(errors?.[0].extensions?.code).toBe(code);
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('Mutation.replyToRefundRequest and updateRefundRequestStatus', () => {
        it('attributes an admin reply to the acting admin', async () => {
            const spy = jest.spyOn(refundRequestRepository, 'addMessage')
                .mockResolvedValue(ok(messageRow({ author: 'admin', message: 'Approved.' })));

            const { data, errors } = single(await server.executeOperation(
                { query: ADMIN_REPLY, variables: { id: 'rfd_1', message: 'Approved.' } },
                { contextValue: createContext({ user: admin }) }
            ));

            expect(errors).toBeUndefined();
            expect(data?.replyToRefundRequest.author).toBe('admin');
            expect(spy).toHaveBeenCalledWith('rfd_1', 'admin', 'Approved.', 42);
        });

        it('blocks a non-admin from replying as the team', async () => {
            const spy = jest.spyOn(refundRequestRepository, 'addMessage');

            const { errors } = single(await server.executeOperation(
                { query: ADMIN_REPLY, variables: { id: 'rfd_1', message: 'Approved.' } },
                { contextValue: createContext({ user: nonAdmin }) }
            ));

            expect(errors?.[0].extensions?.code).toBe('FORBIDDEN');
            expect(spy).not.toHaveBeenCalled();
        });

        it.each(['open', 'in_review', 'approved', 'rejected', 'refunded', 'resolved'] as const)(
            'accepts status %s and records the admin',
            async (status) => {
                const spy = jest.spyOn(refundRequestRepository, 'updateStatus').mockResolvedValue(ok(true));

                const { data, errors } = single(await server.executeOperation(
                    { query: UPDATE_STATUS, variables: { id: 'rfd_1', status } },
                    { contextValue: createContext({ user: admin }) }
                ));

                expect(errors).toBeUndefined();
                expect(data?.updateRefundRequestStatus).toBe(true);
                expect(spy).toHaveBeenCalledWith('rfd_1', status, 42);
            }
        );

        it('rejects a status outside the enum', async () => {
            const spy = jest.spyOn(refundRequestRepository, 'updateStatus');

            const { errors } = single(await server.executeOperation(
                { query: UPDATE_STATUS, variables: { id: 'rfd_1', status: 'closed' } },
                { contextValue: createContext({ user: admin }) }
            ));

            expect(errors?.[0].extensions?.code).toBe('BAD_USER_INPUT');
            expect(spy).not.toHaveBeenCalled();
        });

        it('blocks a non-admin from changing status', async () => {
            const spy = jest.spyOn(refundRequestRepository, 'updateStatus');

            const { errors } = single(await server.executeOperation(
                { query: UPDATE_STATUS, variables: { id: 'rfd_1', status: 'approved' } },
                { contextValue: createContext({ user: nonAdmin }) }
            ));

            expect(errors?.[0].extensions?.code).toBe('FORBIDDEN');
            expect(spy).not.toHaveBeenCalled();
        });
    });
});
