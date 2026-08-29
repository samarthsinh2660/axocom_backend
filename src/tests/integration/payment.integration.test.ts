import { ApolloServer } from '@apollo/server';
import { createTestServer, createContext } from '../setup';
import { ok, err } from 'neverthrow';
import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { delegatePassRepository } from '../../repositories/delegate_pass.repository';
import type { DelegatePassRegistrationRow } from '../../models/delegate_pass.model';
import type { NominationRegistrationRow } from '../../models/nomination.model';
import { nominationRepository } from '../../repositories/nomination.repository';
import * as razorpay from '../../utils/razorpay';
import { ERRORS } from '../../utils/error';
import type { GraphQLContext } from '../../graphql/context';
import type { TokenData } from '../../utils/jwt';

const CREATE_ORDER = `
  mutation CreatePaymentOrder($registrationType: RegistrationType!, $registrationId: ID!) {
    createPaymentOrder(registrationType: $registrationType, registrationId: $registrationId) {
      orderId amount currency keyId registrationId registrationType
      prefillName prefillEmail prefillContact
    }
  }
`;

const VERIFY = `
  mutation VerifyPayment($input: VerifyPaymentInput!) {
    verifyPayment(input: $input) {
      verified registrationId paymentStatus razorpayOrderId razorpayPaymentId
    }
  }
`;

const RECONCILE = `
  mutation ReconcilePayment($registrationType: RegistrationType!, $registrationId: ID!) {
    reconcilePayment(registrationType: $registrationType, registrationId: $registrationId) {
      ourPaymentStatus ourAmount orderId orderStatus amountPaid settleable
      payments { paymentId status amount method }
      capturedPayment { paymentId status amount }
    }
  }
`;

const SETTLE = `
  mutation SettlePaymentFromGateway($registrationType: RegistrationType!, $registrationId: ID!) {
    settlePaymentFromGateway(registrationType: $registrationType, registrationId: $registrationId) {
      ourPaymentStatus settleable capturedPayment { paymentId }
    }
  }
`;

const admin: TokenData = { id: 42, is_admin: true, email: 'admin@example.com' };
const nonAdmin: TokenData = { id: 2, is_admin: false, email: 'user@example.com' };

// One shape covers both registrations: the payment resolvers read the same
// columns from either table, so each call site casts to the row it stands in for.
const row = (over: Record<string, unknown> = {}) => ({
    id: 'dlg_1',
    full_name: 'Asha Menon',
    email: 'asha@example.com',
    phone: '9876543210',
    total_amount: 707764,
    currency: 'INR',
    payment_status: 'pending',
    razorpay_order_id: null,
    ...over,
}) as DelegatePassRegistrationRow;

const captured = {
    paymentId: 'pay_1', status: 'captured', amount: 707764,
    method: 'upi', email: 'asha@example.com', contact: '9876543210', createdAt: 1,
};

const gateway = (over: Record<string, unknown> = {}) => ({
    orderId: 'order_1', orderStatus: 'paid', orderAmount: 707764, amountPaid: 707764,
    payments: [captured], capturedPayment: captured, ...over,
});

const validVerify = {
    registrationType: 'delegate_pass',
    registrationId: 'dlg_1',
    razorpayOrderId: 'order_1',
    razorpayPaymentId: 'pay_1',
    razorpaySignature: 'a'.repeat(64),
};

function single(response: any) {
    expect(response.body.kind).toBe('single');
    return response.body.singleResult;
}

describe('Payment integration(schema + resolvers)', () => {
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
        jest.spyOn(razorpay, 'getRazorpayKeyId').mockReturnValue(ok('rzp_test_key'));
    });

    afterAll(async () => {
        await server.stop();
    });

    describe('Mutation.createPaymentOrder', () => {
        it('charges the stored total and returns the public key id', async () => {
            jest.spyOn(delegatePassRepository, 'getById').mockResolvedValue(ok(row()));
            const orderSpy = jest.spyOn(razorpay, 'createRazorpayOrder')
                .mockResolvedValue(ok({ orderId: 'order_1', amount: 707764, currency: 'INR' }));
            jest.spyOn(delegatePassRepository, 'attachRazorpayOrder').mockResolvedValue(ok(true));

            const { data, errors } = single(await server.executeOperation(
                { query: CREATE_ORDER, variables: { registrationType: 'delegate_pass', registrationId: 'dlg_1' } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors).toBeUndefined();
            expect(data?.createPaymentOrder).toMatchObject({
                orderId: 'order_1', amount: 707764, keyId: 'rzp_test_key',
                prefillName: 'Asha Menon', prefillEmail: 'asha@example.com',
            });
            // Amount comes from the row, and the receipt ties it back to it.
            expect(orderSpy.mock.calls[0][0]).toMatchObject({ amount: 707764, receipt: 'dlg_1' });
        });

        it('never exposes the key secret', async () => {
            jest.spyOn(delegatePassRepository, 'getById').mockResolvedValue(ok(row()));
            jest.spyOn(razorpay, 'createRazorpayOrder')
                .mockResolvedValue(ok({ orderId: 'order_1', amount: 707764, currency: 'INR' }));
            jest.spyOn(delegatePassRepository, 'attachRazorpayOrder').mockResolvedValue(ok(true));

            const { data } = single(await server.executeOperation(
                { query: CREATE_ORDER, variables: { registrationType: 'delegate_pass', registrationId: 'dlg_1' } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(JSON.stringify(data)).not.toMatch(/secret/i);
        });

        it.each(['paid', 'refunded'])('refuses to open an order for a %s registration', async (status) => {
            jest.spyOn(delegatePassRepository, 'getById').mockResolvedValue(ok(row({ payment_status: status })));
            const orderSpy = jest.spyOn(razorpay, 'createRazorpayOrder');

            const { errors } = single(await server.executeOperation(
                { query: CREATE_ORDER, variables: { registrationType: 'delegate_pass', registrationId: 'dlg_1' } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors?.[0].extensions?.errorCode).toBe(90006);
            expect(orderSpy).not.toHaveBeenCalled();
        });

        it('routes a nomination to the nomination repository', async () => {
            jest.spyOn(nominationRepository, 'getById').mockResolvedValue(ok(row({
                id: 'nom_1', nominee_name: 'Ravi Kumar', total_amount: 2359882,
            }) as unknown as NominationRegistrationRow));
            jest.spyOn(razorpay, 'createRazorpayOrder')
                .mockResolvedValue(ok({ orderId: 'order_n', amount: 2359882, currency: 'INR' }));
            jest.spyOn(nominationRepository, 'attachRazorpayOrder').mockResolvedValue(ok(true));
            const delegateSpy = jest.spyOn(delegatePassRepository, 'getById');

            const { data } = single(await server.executeOperation(
                { query: CREATE_ORDER, variables: { registrationType: 'nomination', registrationId: 'nom_1' } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(data?.createPaymentOrder.prefillName).toBe('Ravi Kumar');
            expect(delegateSpy).not.toHaveBeenCalled();
        });

        it('rejects a registration type outside the enum', async () => {
            const { errors } = single(await server.executeOperation(
                { query: CREATE_ORDER, variables: { registrationType: 'sponsorship', registrationId: 'x' } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors?.[0].extensions?.code).toBe('BAD_USER_INPUT');
        });

        it('surfaces a gateway auth failure without leaking internals', async () => {
            jest.spyOn(delegatePassRepository, 'getById').mockResolvedValue(ok(row()));
            jest.spyOn(razorpay, 'createRazorpayOrder').mockResolvedValue(err(ERRORS.RAZORPAY_AUTH_FAILED));

            const { errors } = single(await server.executeOperation(
                { query: CREATE_ORDER, variables: { registrationType: 'delegate_pass', registrationId: 'dlg_1' } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors?.[0].extensions?.errorCode).toBe(90003);
            expect(errors?.[0].message).not.toMatch(/key|secret/i);
        });
    });

    describe('Mutation.verifyPayment', () => {
        it('marks paid and returns the receipt references', async () => {
            jest.spyOn(razorpay, 'verifyPaymentSignature').mockReturnValue(ok(true));
            jest.spyOn(delegatePassRepository, 'markPaid').mockResolvedValue(ok(true));

            const { data, errors } = single(await server.executeOperation(
                { query: VERIFY, variables: { input: validVerify } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors).toBeUndefined();
            expect(data?.verifyPayment).toEqual({
                verified: true, registrationId: 'dlg_1', paymentStatus: 'paid',
                razorpayOrderId: 'order_1', razorpayPaymentId: 'pay_1',
            });
        });

        it('rejects an invalid signature and never writes', async () => {
            jest.spyOn(razorpay, 'verifyPaymentSignature').mockReturnValue(ok(false));
            const markSpy = jest.spyOn(delegatePassRepository, 'markPaid');

            const { errors } = single(await server.executeOperation(
                { query: VERIFY, variables: { input: validVerify } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors?.[0].extensions?.errorCode).toBe(90005);
            expect(markSpy).not.toHaveBeenCalled();
        });

        it.each(['razorpayOrderId', 'razorpayPaymentId', 'razorpaySignature'])(
            'rejects a payload with a blank %s before checking the signature',
            async (field) => {
                const sigSpy = jest.spyOn(razorpay, 'verifyPaymentSignature');

                const { errors } = single(await server.executeOperation(
                    { query: VERIFY, variables: { input: { ...validVerify, [field]: '' } } },
                    { contextValue: createContext({ user: null }) }
                ));

                expect(errors?.[0].extensions?.code).toBe('BAD_USER_INPUT');
                expect(sigSpy).not.toHaveBeenCalled();
            }
        );

        it.each([
            ['order belonging to another registration', ERRORS.PAYMENT_ORDER_MISMATCH, 90007],
            ['a replayed verification', ERRORS.PAYMENT_ALREADY_COMPLETED, 90006],
        ])('surfaces %s', async (_n, error, code) => {
            jest.spyOn(razorpay, 'verifyPaymentSignature').mockReturnValue(ok(true));
            jest.spyOn(delegatePassRepository, 'markPaid').mockResolvedValue(err(error));

            const { errors } = single(await server.executeOperation(
                { query: VERIFY, variables: { input: validVerify } },
                { contextValue: createContext({ user: null }) }
            ));

            expect(errors?.[0].extensions?.errorCode).toBe(code);
        });
    });

    describe('Mutation.reconcilePayment', () => {
        it('reports the gateway record beside ours', async () => {
            jest.spyOn(delegatePassRepository, 'getById').mockResolvedValue(ok(row()));
            const spy = jest.spyOn(razorpay, 'reconcileByReceipt').mockResolvedValue(ok(gateway()));

            const { data, errors } = single(await server.executeOperation(
                { query: RECONCILE, variables: { registrationType: 'delegate_pass', registrationId: 'dlg_1' } },
                { contextValue: createContext({ user: admin }) }
            ));

            expect(errors).toBeUndefined();
            expect(data?.reconcilePayment).toMatchObject({
                ourPaymentStatus: 'pending', amountPaid: 707764, settleable: true,
                capturedPayment: { paymentId: 'pay_1', status: 'captured' },
            });
            // Keyed on the registration id, not the row's stored order id.
            expect(spy).toHaveBeenCalledWith('dlg_1');
        });

        it.each([
            ['pending', true],
            ['failed', true],
            ['paid', false],
            ['refunded', false],
        ])('reports settleable=%s for a %s row', async (status, expected) => {
            jest.spyOn(delegatePassRepository, 'getById').mockResolvedValue(ok(row({ payment_status: status })));
            jest.spyOn(razorpay, 'reconcileByReceipt').mockResolvedValue(ok(gateway()));

            const { data } = single(await server.executeOperation(
                { query: RECONCILE, variables: { registrationType: 'delegate_pass', registrationId: 'dlg_1' } },
                { contextValue: createContext({ user: admin }) }
            ));

            expect(data?.reconcilePayment.settleable).toBe(expected);
        });

        it('is never settleable when nothing was captured', async () => {
            jest.spyOn(delegatePassRepository, 'getById').mockResolvedValue(ok(row()));
            jest.spyOn(razorpay, 'reconcileByReceipt')
                .mockResolvedValue(ok(gateway({ payments: [], capturedPayment: null, amountPaid: 0 })));

            const { data } = single(await server.executeOperation(
                { query: RECONCILE, variables: { registrationType: 'delegate_pass', registrationId: 'dlg_1' } },
                { contextValue: createContext({ user: admin }) }
            ));

            expect(data?.reconcilePayment.settleable).toBe(false);
            expect(data?.reconcilePayment.capturedPayment).toBeNull();
        });

        it('reports an order the gateway has never seen', async () => {
            jest.spyOn(delegatePassRepository, 'getById').mockResolvedValue(ok(row()));
            jest.spyOn(razorpay, 'reconcileByReceipt')
                .mockResolvedValue(err(ERRORS.PAYMENT_ORDER_NOT_AT_GATEWAY));

            const { errors } = single(await server.executeOperation(
                { query: RECONCILE, variables: { registrationType: 'delegate_pass', registrationId: 'dlg_1' } },
                { contextValue: createContext({ user: admin }) }
            ));

            expect(errors?.[0].extensions?.errorCode).toBe(90009);
        });

        it.each([
            ['anonymous', null, 'UNAUTHORIZED'],
            ['non-admin', nonAdmin, 'FORBIDDEN'],
        ])('blocks a %s caller', async (_n, user, code) => {
            const spy = jest.spyOn(razorpay, 'reconcileByReceipt');

            const { errors } = single(await server.executeOperation(
                { query: RECONCILE, variables: { registrationType: 'delegate_pass', registrationId: 'dlg_1' } },
                { contextValue: createContext({ user: user as TokenData | null }) }
            ));

            expect(errors?.[0].extensions?.code).toBe(code);
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('Mutation.settlePaymentFromGateway', () => {
        it('settles using the order that holds the money', async () => {
            jest.spyOn(delegatePassRepository, 'getById')
                .mockResolvedValue(ok(row({ razorpay_order_id: 'order_STALE' })));
            jest.spyOn(razorpay, 'reconcileByReceipt').mockResolvedValue(ok(gateway()));
            const settleSpy = jest.spyOn(delegatePassRepository, 'markPaidFromGateway').mockResolvedValue(ok(true));

            const { data, errors } = single(await server.executeOperation(
                { query: SETTLE, variables: { registrationType: 'delegate_pass', registrationId: 'dlg_1' } },
                { contextValue: createContext({ user: admin }) }
            ));

            expect(errors).toBeUndefined();
            expect(data?.settlePaymentFromGateway).toMatchObject({
                ourPaymentStatus: 'paid', settleable: false,
            });
            expect(settleSpy).toHaveBeenCalledWith(
                'dlg_1', { orderId: 'order_1', paymentId: 'pay_1' }, 42
            );
        });

        it('refuses when the gateway captured nothing', async () => {
            jest.spyOn(delegatePassRepository, 'getById').mockResolvedValue(ok(row()));
            jest.spyOn(razorpay, 'reconcileByReceipt')
                .mockResolvedValue(ok(gateway({ payments: [], capturedPayment: null })));
            const settleSpy = jest.spyOn(delegatePassRepository, 'markPaidFromGateway');

            const { errors } = single(await server.executeOperation(
                { query: SETTLE, variables: { registrationType: 'delegate_pass', registrationId: 'dlg_1' } },
                { contextValue: createContext({ user: admin }) }
            ));

            expect(errors?.[0].extensions?.errorCode).toBe(90010);
            expect(settleSpy).not.toHaveBeenCalled();
        });

        it('refuses to settle a refunded registration', async () => {
            jest.spyOn(delegatePassRepository, 'getById')
                .mockResolvedValue(ok(row({ payment_status: 'refunded' })));
            jest.spyOn(razorpay, 'reconcileByReceipt').mockResolvedValue(ok(gateway()));
            const settleSpy = jest.spyOn(delegatePassRepository, 'markPaidFromGateway');

            const { errors } = single(await server.executeOperation(
                { query: SETTLE, variables: { registrationType: 'delegate_pass', registrationId: 'dlg_1' } },
                { contextValue: createContext({ user: admin }) }
            ));

            expect(errors?.[0].extensions?.errorCode).toBe(90011);
            expect(settleSpy).not.toHaveBeenCalled();
        });

        it('blocks a non-admin', async () => {
            const settleSpy = jest.spyOn(delegatePassRepository, 'markPaidFromGateway');

            const { errors } = single(await server.executeOperation(
                { query: SETTLE, variables: { registrationType: 'delegate_pass', registrationId: 'dlg_1' } },
                { contextValue: createContext({ user: nonAdmin }) }
            ));

            expect(errors?.[0].extensions?.code).toBe('FORBIDDEN');
            expect(settleSpy).not.toHaveBeenCalled();
        });
    });
});
