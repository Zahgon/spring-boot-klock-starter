import type { JoinPoint, MethodHandle, ParameterHandle } from '../deps/aspect.js';
import { nullSafeToString, isEmpty as isObjectEmpty } from '../deps/object-utils.js';
import {
  MethodBasedEvaluationContext,
  SpelExpressionParser,
  StandardEvaluationContext,
} from '../deps/spel.js';
import { collectionToDelimitedString } from '../deps/string-utils.js';
import type { KlockAnnotation } from '../annotation/klock.js';
import { KLOCK_KEY } from '../annotation/klock-key.js';

/**
 * Created by kl on 2018/1/24.
 * Content: resolves the user-defined business key.
 */
export class BusinessKeyProvider {
  private readonly parser = new SpelExpressionParser();

  getKeyName(joinPoint: JoinPoint, klock: KlockAnnotation): string {
    const keyList: string[] = [];
    const method = this.getMethod(joinPoint);
    const definitionKeys = this.getSpelDefinitionKey(klock.keys, method, joinPoint.getArgs());
    keyList.push(...definitionKeys);
    const parameterKeys = this.getParameterKey(
      joinPoint.getSignature().getParameters(),
      joinPoint.getArgs(),
    );
    keyList.push(...parameterKeys);
    return collectionToDelimitedString(keyList, '', '-', '');
  }

  private getMethod(joinPoint: JoinPoint): MethodHandle {
    return joinPoint.getSignature().getMethod();
  }

  private getSpelDefinitionKey(
    definitionKeys: readonly string[],
    method: MethodHandle,
    parameterValues: readonly unknown[],
  ): string[] {
    const definitionKeyList: string[] = [];
    for (const definitionKey of definitionKeys) {
      if (!isObjectEmpty(definitionKey)) {
        const context = new MethodBasedEvaluationContext(
          null,
          method.getParameterNames(),
          parameterValues,
        );
        const objKey = this.parser.parseExpression(definitionKey).getValue(context);
        definitionKeyList.push(nullSafeToString(objKey));
      }
    }
    return definitionKeyList;
  }

  private getParameterKey(
    parameters: readonly ParameterHandle[],
    parameterValues: readonly unknown[],
  ): string[] {
    const parameterKey: string[] = [];
    for (let i = 0; i < parameters.length; i++) {
      const parameter = parameters[i] as ParameterHandle;
      const keyAnnotation = parameter.getAnnotation(KLOCK_KEY);
      if (keyAnnotation !== null) {
        if (keyAnnotation.value.length === 0) {
          const parameterValue = parameterValues[i];
          parameterKey.push(nullSafeToString(parameterValue));
        } else {
          const context = new StandardEvaluationContext(parameterValues[i]);
          const key = this.parser.parseExpression(keyAnnotation.value).getValue(context);
          parameterKey.push(nullSafeToString(key));
        }
      }
    }
    return parameterKey;
  }
}
