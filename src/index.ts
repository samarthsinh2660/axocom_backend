import { ApolloServer } from '@apollo/server';
import http from "http";
// import { startStandaloneServer } from '@apollo/server/standalone';
// import { readFileSync } from 'fs';
import cookieParser from "cookie-parser";
// import { join } from 'path';
import { CORS_ORIGIN, PORT } from './config/env';
import { connectToDatabase } from './dataconfig/db';
// import { candidateResolvers } from './graphql/resolvers/candidate.resolver';
import express from 'express';
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { expressMiddleware } from '@as-integrations/express5';
import { limiter } from './middleware/ratelimit.middleware';
import cors from 'cors';
import { buildGraphQL } from './graphql/loaders/graphql.loader';
import { notFoundHandler } from './middleware/error.middleware';
// import candidateRouter from './rest/routes/candidate.route';
import { optionalAuth } from './middleware/auth.middleware';
import { createLoaders } from './graphql/loaders/dataloader';
import voterRoutes from './rest/routes/voter.route';
import { isTestPricingActive } from './config/pricing';
import razorpayWebhookRoutes from './rest/routes/razorpay-webhook.route';
// async function startGraphQLServer() {
//     const typeDefs = readFileSync(
//         join(process.cwd(), 'src/graphql/schema/candidate.schema.graphql'),
//         'utf-8'
//     );

//     const apolloServer = new ApolloServer({
//         typeDefs,
//         resolvers: candidateResolvers,
//     });

//     await connectToDatabase();
//     console.log("Database connected");

//     const { url } = await startStandaloneServer(apolloServer, {
//         listen: { port: parseInt(PORT || '3000', 10) },
//     });

//     console.log(`Apollo Server is running on ${url}`);
// }

// startGraphQLServer();

async function startServer() {

    const { typeDefs, resolvers } = buildGraphQL();


    const app = express();
    const httpServer = http.createServer(app);
    app.use(cors({
        origin: CORS_ORIGIN,
        credentials: true
    }));
    app.use(limiter);

    // Before express.json(): the webhook signature covers the raw bytes.
    app.use('/webhooks', razorpayWebhookRoutes);

    app.use(express.json({ limit: '10mb' }));
    //process html data in to json form
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    //to store user data  
    app.use(cookieParser());


    app.get('/health', (req, res) => {
        res.json({ status: 'OK', timestamp: new Date().toISOString() });
    });
    app.get('/', (_, res) => {
        res.json({
            success: true,
            message: 'axocom api is running'
        });
    })

    //routes
    // app.use('/api/candidates', candidateRouter);
    app.use('/api/voters', voterRoutes);

    const apollo = new ApolloServer({
        typeDefs,
        resolvers,
        plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
        // validationRules: [depthLimit(5)],
        // introspection: process.env.NODE_ENV !== 'production',
    });

    await apollo.start();
    app.use(
        "/graphql",
        express.json(),
        optionalAuth,
        expressMiddleware(apollo, {
            context: async ({ req }) => ({ req, user: req.user ?? null, loaders: createLoaders() }),
        })
    );

    await connectToDatabase();

    // Test pricing rewrites every amount, so announce it on boot.
    if (isTestPricingActive()) {
        console.warn(
            '\n*** TEST PRICING ACTIVE - every pass and plan is charged as PAYMENT_TEST_AMOUNT_PAISE. ***\n'
            + '*** Real money still moves if RAZORPAY_KEY_ID is a live key. Unset it for real prices. ***\n'
        );
    }

    httpServer.listen(PORT);
    console.log(`Server is running on port ${PORT}`);
    console.log(`GraphQL endpoint is running on http://localhost:${PORT}/graphql`);

    app.use(notFoundHandler);
}

startServer();
