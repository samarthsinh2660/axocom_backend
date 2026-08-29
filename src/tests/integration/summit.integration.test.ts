import { ApolloServer } from '@apollo/server';
import { createTestServer, createContext } from '../setup';
import { ok, err } from 'neverthrow';
import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { delegatePassRepository } from '../../repositories/delegate_pass.repository';
import type { DelegatePassRegistrationRow } from '../../models/delegate_pass.model';
import { nominationRepository } from '../../repositories/nomination.repository';
import { refundRequestRepository } from '../../repositories/refund_request.repository';
import { ERRORS } from '../../utils/error';
import type { GraphQLContext } from '../../graphql/context';
import type { TokenData } from '../../utils/jwt';

const REGISTER_DELEGATE = `
  mutation RegisterDelegatePass($input: RegisterDelegatePassInput!) {
    registerDelegatePass(input: $input) {
      registrationId
      subtotalAmount
      gstAmount
      gstRateBps
      totalAmount
      paymentStatus
    }
  }
`;

const REGISTER_NOMINATION = `
  mutation RegisterNomination($input: RegisterNominationInput!) {
    registerNomination(input: $input) {
      registrationId
      subtotalAmount
      gstAmount
      totalAmount
      paymentStatus
    }
  }
`;

const ADMIN_DELEGATES = `
  query AdminDelegatePassRegistrations($paymentStatus: PaymentStatus, $search: String) {
    adminDelegatePassRegistrations(paymentStatus: $paymentStatus, search: $search) {
      data {
        id
        fullName
        passName
        audience
        quantity
        unitAmount
        unitGstAmount
        subtotalAmount
        gstRateBps
        gstAmount
        totalAmount
        gstNumber
        startupDetails
        paymentStatus
      }
      pagination { total page limit totalPages }
    }
  }
`;

const ADMIN_STATS = `
  query { adminSummitStats {
    delegatePaid { count amount }
    delegatePending { count amount }
    nominationPaid { count amount }
    nominationPending { count amount }
    openRefundRequests
  } }
`;

const UPDATE_DELEGATE_STATUS = `
  mutation UpdateDelegatePassPaymentStatus($id: ID!, $input: UpdatePaymentStatusInput!) {
    updateDelegatePassPaymentStatus(id: $id, input: $input)
  }
`;

const admin: TokenData = { id: 42, is_admin: true, email: 'admin@example.com' };
const nonAdmin: TokenData = { id: 2, is_admin: false, email: 'user@example.com' };

const validDelegateInput = {
    fullName: 'Asha Menon',
    designation: 'CTO',
    organisation: 'Acme Labs',
    email: 'asha@example.com',
    phone: '9876543210',
    passName: 'Professional Pass',
    quantity: 2,
    contactConsent: true,
};

const delegateRow = {
    id: 'dlg_1',
    full_name: 'Asha Menon',
    designation: 'CTO',
    organisation: 'Acme Labs',
    email: 'asha@example.com',
    phone: '9876543210',
    pass_name: 'Professional Pass',
    audience: 'Professionals',
    quantity: 2,
    unit_amount: 299900,
    unit_gst_amount: 53982,
    subtotal_amount: 599800,
    gst_rate_bps: 1800,
    gst_amount: 107964,
    total_amount: 707764,
    currency: 'INR',
    gst_number: null,
    startup_details: null,
    contact_consent_at: new Date('2026-01-01'),
    payment_status: 'pending',
    razorpay_order_id: null,
    razorpay_payment_id: null,
    paid_at: null,
    admin_note: null,
    reviewed_at: null,
    reviewed_by_admin_id: null,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
};

function single(response: any) {
    expect(response.body.kind).toBe('single');
    return response.body.singleResult;
}

describe('Summit registration integration(schema + resolvers)', () => {
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

    describe('Mutation.registerDelegatePass', () => {
        it('registers without a session and returns the GST breakdown', async () => {
            jest.spyOn(delegatePassRepository, 'create').mockResolvedValue(ok({
                registrationId: 'dlg_1',
                subtotalAmount: 599800,
                gstAmount: 107964,
                gstRateBps: 1800,
                totalAmount: 707764,
                paymentStatus: 'pending',
            }));

            const { data, errors } = single(await server.executeOperation(
                { query: REGISTER_DELEGATE, variables: { input: validDelegateInput } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors).toBeUndefined();
            expect(data?.registerDelegatePass).toMatchObject({
                registrationId: 'dlg_1',
                subtotalAmount: 599800,
                gstAmount: 107964,
                totalAmount: 707764,
                paymentStatus: 'pending',
            });
        });

        it('never passes an amount from the request to the repository', async () => {
            const spy = jest.spyOn(delegatePassRepository, 'create').mockResolvedValue(ok({
                registrationId: 'dlg_1',
                subtotalAmount: 599800,
                gstAmount: 107964,
                gstRateBps: 1800,
                totalAmount: 707764,
                paymentStatus: 'pending',
            }));

            await server.executeOperation(
                {
                    query: REGISTER_DELEGATE,
                    // A tampered client sending its own price and audience.
                    variables: { input: { ...validDelegateInput, unitAmount: 100, audience: 'Startups' } },
                },
                { contextValue: createContext({ user: null }) }
            );

            const passed = spy.mock.calls[0][0] as Record<string, unknown>;
            expect(passed.passName).toBe('Professional Pass');
            expect(passed).not.toHaveProperty('unitAmount');
            expect(passed).not.toHaveProperty('audience');
        });

        it('accepts the legacy fields so an older client is not broken', async () => {
            jest.spyOn(delegatePassRepository, 'create').mockResolvedValue(ok({
                registrationId: 'dlg_1',
                subtotalAmount: 599800,
                gstAmount: 107964,
                gstRateBps: 1800,
                totalAmount: 707764,
                paymentStatus: 'pending',
            }));

            const { errors } = single(await server.executeOperation(
                {
                    query: REGISTER_DELEGATE,
                    variables: { input: { ...validDelegateInput, unitAmount: 299900, audience: 'Professionals' } },
                },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors).toBeUndefined();
        });

        it.each([
            ['INVALID_QUANTITY', ERRORS.INVALID_QUANTITY, 70005],
            ['INVALID_PASS_SELECTION', ERRORS.INVALID_PASS_SELECTION, 70003],
            ['STARTUP_DETAILS_REQUIRED', ERRORS.STARTUP_DETAILS_REQUIRED, 70007],
        ])('surfaces %s from the repository with its domain code', async (_n, error, code) => {
            jest.spyOn(delegatePassRepository, 'create').mockResolvedValue(err(error));

            const { errors } = single(await server.executeOperation(
                { query: REGISTER_DELEGATE, variables: { input: validDelegateInput } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors?.[0].extensions?.errorCode).toBe(code);
        });

        it('rejects a payload missing a required field at the schema level', async () => {
            const spy = jest.spyOn(delegatePassRepository, 'create');
            const { errors } = single(await server.executeOperation(
                { query: REGISTER_DELEGATE, variables: { input: { fullName: 'Only a name' } } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors?.[0].extensions?.code).toBe('BAD_USER_INPUT');
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('Mutation.registerNomination', () => {
        it('registers and returns the charged total', async () => {
            jest.spyOn(nominationRepository, 'create').mockResolvedValue(ok({
                registrationId: 'nom_1',
                subtotalAmount: 1999900,
                gstAmount: 359982,
                gstRateBps: 1800,
                totalAmount: 2359882,
                paymentStatus: 'pending',
            }));

            const { data, errors } = single(await server.executeOperation(
                {
                    query: REGISTER_NOMINATION,
                    variables: {
                        input: {
                            nomineeName: 'Ravi Kumar',
                            organisation: 'InnovateX',
                            designation: 'Founder',
                            email: 'ravi@example.com',
                            phone: '9876500011',
                            achievements: 'Rural AI clinics',
                            planName: 'Premium Nomination',
                            contactConsent: true,
                        },
                    },
                },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors).toBeUndefined();
            expect(data?.registerNomination.totalAmount).toBe(2359882);
        });

        it('surfaces an unlisted plan as a domain error', async () => {
            jest.spyOn(nominationRepository, 'create').mockResolvedValue(err(ERRORS.INVALID_NOMINATION_PLAN));

            const { errors } = single(await server.executeOperation(
                {
                    query: REGISTER_NOMINATION,
                    variables: {
                        input: {
                            nomineeName: 'X', organisation: 'Y', designation: 'Z',
                            email: 'x@example.com', phone: '9876500011',
                            achievements: 'A', planName: 'Free Nomination', contactConsent: true,
                        },
                    },
                },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors?.[0].extensions?.errorCode).toBe(70004);
        });
    });

    describe('Query.adminDelegatePassRegistrations', () => {
        it('maps every stored column onto the GraphQL shape', async () => {
            jest.spyOn(delegatePassRepository, 'listAdmin').mockResolvedValue(ok({
                data: [delegateRow as DelegatePassRegistrationRow],
                pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
            }));

            const { data, errors } = single(await server.executeOperation(
                { query: ADMIN_DELEGATES, variables: {} },
                { contextValue: createContext({ user: admin }) }
            ));

            expect(errors).toBeUndefined();
            expect(data?.adminDelegatePassRegistrations.data[0]).toMatchObject({
                id: 'dlg_1',
                passName: 'Professional Pass',
                audience: 'Professionals',
                unitAmount: 299900,
                unitGstAmount: 53982,
                subtotalAmount: 599800,
                gstRateBps: 1800,
                gstAmount: 107964,
                totalAmount: 707764,
                paymentStatus: 'pending',
            });
        });

        it('returns the startup details when present', async () => {
            jest.spyOn(delegatePassRepository, 'listAdmin').mockResolvedValue(ok({
                data: [{ ...delegateRow, startup_details: 'We build clinic software.' } as DelegatePassRegistrationRow],
                pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
            }));

            const { data } = single(await server.executeOperation(
                { query: ADMIN_DELEGATES, variables: {} },
                { contextValue: createContext({ user: admin }) }
            ));

            expect(data?.adminDelegatePassRegistrations.data[0].startupDetails)
                .toBe('We build clinic software.');
        });

        it('passes the payment status filter through', async () => {
            const spy = jest.spyOn(delegatePassRepository, 'listAdmin').mockResolvedValue(ok({
                data: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 1 },
            }));

            await server.executeOperation(
                { query: ADMIN_DELEGATES, variables: { paymentStatus: 'paid', search: 'asha' } },
                { contextValue: createContext({ user: admin }) }
            );

            expect(spy.mock.calls[0][0]).toMatchObject({ paymentStatus: 'paid', search: 'asha' });
        });

        it('rejects a payment status outside the enum before reaching the resolver', async () => {
            const spy = jest.spyOn(delegatePassRepository, 'listAdmin');

            const { errors } = single(await server.executeOperation(
                { query: ADMIN_DELEGATES, variables: { paymentStatus: 'settled' } },
                { contextValue: createContext({ user: admin }) }
            ));

            expect(errors?.[0].extensions?.code).toBe('BAD_USER_INPUT');
            expect(spy).not.toHaveBeenCalled();
        });

        it('blocks an anonymous caller', async () => {
            const spy = jest.spyOn(delegatePassRepository, 'listAdmin');

            const { errors } = single(await server.executeOperation(
                { query: ADMIN_DELEGATES, variables: {} },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors?.[0].extensions?.code).toBe('UNAUTHORIZED');
            expect(spy).not.toHaveBeenCalled();
        });

        it('blocks a signed-in non-admin', async () => {
            const spy = jest.spyOn(delegatePassRepository, 'listAdmin');

            const { errors } = single(await server.executeOperation(
                { query: ADMIN_DELEGATES, variables: {} },
                { contextValue: createContext({ user: nonAdmin }) }
            ));

            expect(errors?.[0].extensions?.code).toBe('FORBIDDEN');
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('Mutation.updateDelegatePassPaymentStatus', () => {
        it('records the acting admin', async () => {
            const spy = jest.spyOn(delegatePassRepository, 'updatePaymentStatus').mockResolvedValue(ok(true));

            const { data, errors } = single(await server.executeOperation(
                {
                    query: UPDATE_DELEGATE_STATUS,
                    variables: { id: 'dlg_1', input: { paymentStatus: 'paid', adminNote: 'Verified' } },
                },
                { contextValue: createContext({ user: admin }) }
            ));

            expect(errors).toBeUndefined();
            expect(data?.updateDelegatePassPaymentStatus).toBe(true);
            expect(spy).toHaveBeenCalledWith('dlg_1', 'paid', 'Verified', 42);
        });

        it('blocks a non-admin', async () => {
            const spy = jest.spyOn(delegatePassRepository, 'updatePaymentStatus');

            const { errors } = single(await server.executeOperation(
                { query: UPDATE_DELEGATE_STATUS, variables: { id: 'dlg_1', input: { paymentStatus: 'paid' } } },
                { contextValue: createContext({ user: nonAdmin }) }
            ));

            expect(errors?.[0].extensions?.code).toBe('FORBIDDEN');
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('Query.adminSummitStats', () => {
        it('aggregates both registration types and open queries', async () => {
            jest.spyOn(delegatePassRepository, 'countByPaymentStatus')
                .mockResolvedValueOnce(ok({ count: 3, amount: 2123292 }))
                .mockResolvedValueOnce(ok({ count: 1, amount: 353882 }));
            jest.spyOn(nominationRepository, 'countByPaymentStatus')
                .mockResolvedValueOnce(ok({ count: 2, amount: 4719764 }))
                .mockResolvedValueOnce(ok({ count: 4, amount: 9439528 }));
            jest.spyOn(refundRequestRepository, 'countByStatus').mockResolvedValue(ok(5));

            const { data, errors } = single(await server.executeOperation(
                { query: ADMIN_STATS },
                { contextValue: createContext({ user: admin }) }
            ));

            expect(errors).toBeUndefined();
            expect(data?.adminSummitStats).toEqual({
                delegatePaid: { count: 3, amount: 2123292 },
                delegatePending: { count: 1, amount: 353882 },
                nominationPaid: { count: 2, amount: 4719764 },
                nominationPending: { count: 4, amount: 9439528 },
                openRefundRequests: 5,
            });
        });

        it('blocks a non-admin', async () => {
            const { errors } = single(await server.executeOperation(
                { query: ADMIN_STATS },
                { contextValue: createContext({ user: nonAdmin }) }
            ));

            expect(errors?.[0].extensions?.code).toBe('FORBIDDEN');
        });
    });
});
