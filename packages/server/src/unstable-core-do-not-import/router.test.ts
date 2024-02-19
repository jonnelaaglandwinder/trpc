import { initTRPC } from '..';

const t = initTRPC.create();

describe('router', () => {
  test('is a reserved word', async () => {
    expect(() => {
      return t.router({
        then: t.procedure.query(() => 'hello'),
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: Reserved words used in \`router({})\` call: then]`,
    );
  });

  // Regression https://github.com/trpc/trpc/pull/2562
  test('because it creates async fns that returns proxy objects', async () => {
    const appRouter = t.router({});
    const asyncFnThatReturnsCaller = async () => appRouter.createCaller({});

    await asyncFnThatReturnsCaller();
  });

  test('should not duplicate key', async () => {
    expect(() =>
      t.router({
        foo: t.router({
          '.bar': t.procedure.query(() => 'bar' as const),
        }),
        'foo.': t.router({
          bar: t.procedure.query(() => 'bar' as const),
        }),
      }),
    ).toThrow('Duplicate key: foo..bar');
  });
});

describe('RouterCaller', () => {
  describe('onError handler', () => {
    const router = t.router({
      thrower: t.procedure.query(() => {
        throw new Error('error');
      }),
    });

    const factoryHandler = vi.fn();
    const callerHandler = vi.fn();
    const ctx = {
      foo: 'bar',
    };

    test('calling next() in the createCallerFactory error handler should call the one provided to createCaller', async () => {
      const caller = t.createCallerFactory(router, { onError: factoryHandler })(
        ctx,
        { onError: callerHandler },
      );

      factoryHandler.mockImplementationOnce(async ({ next }) => {
        await next();
      });

      await expect(caller.thrower()).rejects.toThrow('error');

      expect(callerHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            cause: expect.objectContaining({
              message: 'error',
            }),
          }),
          ctx,
          path: 'thrower',
          type: 'query',
        }),
      );
    });

    test('handler provided to createCaller should be called directory when no handler is provided to createCallerFactory', async () => {
      const caller = t.createCallerFactory(router)(ctx, {
        onError: callerHandler,
      });

      await expect(caller.thrower()).rejects.toThrow('error');
    });

    test('original TRPCError should be rethrown when neither handler throws', async () => {
      const caller = t.createCallerFactory(router, { onError: factoryHandler })(
        ctx,
        { onError: callerHandler },
      );

      await expect(caller.thrower()).rejects.toThrow('error');

      expect(callerHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            cause: expect.objectContaining({
              message: 'error',
            }),
          }),
          ctx,
          path: 'thrower',
          type: 'query',
        }),
      );
    });

    test('should not intercept errors thrown from any onError handler', async () => {
      const factoryHandlerCaller = t.createCallerFactory(router, {
        onError: factoryHandler,
      })(ctx);
      const callerHandlerCaller = t.createCallerFactory(router)(ctx, {
        onError: callerHandler,
      });

      callerHandler.mockImplementationOnce(() => {
        throw new Error('custom error');
      });
      factoryHandler.mockImplementationOnce(() => {
        throw new Error('custom error');
      });

      await expect(factoryHandlerCaller.thrower()).rejects.toThrow(
        'custom error',
      );
      await expect(callerHandlerCaller.thrower()).rejects.toThrow(
        'custom error',
      );
    });
  });
});
