import type { DeepPartial } from '@trpc/server/unstable-core-do-not-import';
import type { DecoratedMutation, DecoratedQuery } from '../createTRPCReact';
import type { DecorateRouterRecord } from '../shared';

export type QueryType = 'any' | 'infinite' | 'query';

export type TRPCQueryKey = [
  string[],
  { input?: unknown; type?: Exclude<QueryType, 'any'> }?,
];

type ProcedureOrRouter =
  | DecoratedMutation<any>
  | DecoratedQuery<any>
  | DecorateRouterRecord<any, any>;

/**
 * To allow easy interactions with groups of related queries, such as
 * invalidating all queries of a router, we use an array as the path when
 * storing in tanstack query.
 **/
export function getQueryKeyInternal(
  path: string[],
  input: unknown,
  type: QueryType,
): TRPCQueryKey {
  // Construct a query key that is easy to destructure and flexible for
  // partial selecting etc.
  // https://github.com/trpc/trpc/issues/3128

  // some parts of the path may be dot-separated, split them up
  const splitPath = path.flatMap((part) => part.split('.'));

  if (!input && (!type || type === 'any')) {
    // for `utils.invalidate()` to match all queries (including vanilla react-query)
    // we don't want nested array if path is empty, i.e. `[]` instead of `[[]]`
    return splitPath.length ? [splitPath] : ([] as unknown as TRPCQueryKey);
  }

  if (
    type === 'infinite' &&
    input &&
    typeof input === 'object' &&
    'cursor' in input
  ) {
    const { cursor: _, ...inputWithoutCursor } = input;

    return [
      splitPath,
      {
        input: inputWithoutCursor,
        type: 'infinite',
      },
    ];
  }
  return [
    splitPath,
    {
      ...(typeof input !== 'undefined' && { input: input }),
      ...(type && type !== 'any' && { type: type }),
    },
  ];
}

type GetInfiniteQueryInput<
  TProcedureInput,
  TInputWithoutCursor = Omit<TProcedureInput, 'cursor'>,
> = keyof TInputWithoutCursor extends never
  ? undefined
  : DeepPartial<TInputWithoutCursor> | undefined;

/** @internal */
export type GetQueryProcedureInput<TProcedureInput> = TProcedureInput extends {
  cursor?: any;
}
  ? GetInfiniteQueryInput<TProcedureInput>
  : DeepPartial<TProcedureInput> | undefined;

type GetParams<TProcedureOrRouter extends ProcedureOrRouter> =
  TProcedureOrRouter extends DecoratedQuery<infer $Def>
    ? [input?: GetQueryProcedureInput<$Def['input']>, type?: QueryType]
    : [];

/**
 * Method to extract the query key for a procedure
 * @param procedureOrRouter - procedure or AnyRouter
 * @param input - input to procedureOrRouter
 * @param type - defaults to `any`
 * @link https://trpc.io/docs/v11/getQueryKey
 */
export function getQueryKey<TProcedureOrRouter extends ProcedureOrRouter>(
  procedureOrRouter: TProcedureOrRouter,
  ..._params: GetParams<TProcedureOrRouter>
) {
  const [input, type] = _params;

  // @ts-expect-error - we don't expose _def on the type layer
  const path = procedureOrRouter._def().path as string[];
  const queryKey = getQueryKeyInternal(path, input, type ?? 'any');
  return queryKey;
}

// TODO: look over if we can't use a single type
export type QueryKeyKnown<TInput, TType extends Exclude<QueryType, 'any'>> = [
  string[],
  { input?: GetQueryProcedureInput<TInput>; type: TType }?,
];
