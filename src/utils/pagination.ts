/**
 * Offset pagination for the summit and refund repositories. The hackathon
 * repositories keep their own copies; new code should import from here.
 */

export type Pagination = {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
};

export type Paginated<T> = { data: T[]; pagination: Pagination };

const MAX_LIMIT = 100;

export function clampPage(page: number, limit: number) {
    const pageNumber = Math.max(1, page || 1);
    const limitNumber = Math.min(MAX_LIMIT, Math.max(1, limit || 20));
    return { pageNumber, limitNumber, offset: (pageNumber - 1) * limitNumber };
}

export function buildPagination(total: number, pageNumber: number, limitNumber: number): Pagination {
    return {
        total,
        page: pageNumber,
        limit: limitNumber,
        totalPages: Math.ceil(total / limitNumber) || 1,
    };
}
