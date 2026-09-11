# spring-boot-klock-starter
基于redis的分布式锁组件（TypeScript 实现），使得项目拥有分布式锁能力变得异常简单。

# 快速开始

1.添加 klock 组件依赖
```bash
npm install spring-boot-klock-starter
```

2.配置 redis 链接：`spring.klock.address=redis://127.0.0.1:6379`（`application.properties`，或环境变量 `SPRING_KLOCK_ADDRESS`）

3.在需要加分布式锁的方法上，添加装饰器 @Klock，如：
```typescript
import { Klock, LONG_MIN_VALUE } from 'spring-boot-klock-starter';

export class TestService {

    @Klock({ waitTime: LONG_MIN_VALUE })
    async getValue(param: string): Promise<string> {
        if (param === 'sleep') { // 休眠或断点阻塞，达到一直占用锁的测试效果
            await new Promise((resolve) => setTimeout(resolve, 1000 * 50));
        }
        return 'success';
    }
}
```

装饰器需要 `tsconfig.json` 中开启 `"experimentalDecorators": true`。

4.在调用任何 @Klock 方法之前，先构建上下文（等价于 Spring 的自动装配）：
```typescript
import { bindKlockConfig, KlockAutoConfiguration, parseProperties } from 'spring-boot-klock-starter';
import { readFileSync } from 'node:fs';

const klockConfig = bindKlockConfig(parseProperties(readFileSync('application.properties', 'utf8')));
const context = await KlockAutoConfiguration.create(klockConfig);
// ... 应用退出时
await context.shutdown();
```

如果 redis 客户端由应用自己创建，改用 `KlockConfiguration.create(redissonClient)`。

4.支持锁指定的业务key，如同一个方法ID入参相同的加锁，其他的放行。业务key的获取支持Spel，具体使用方式如下  
![使用示例](./doc/img/使用示例.png "使用示例.png")



# 使用参数说明

> 配置参数说明

```properties
spring.klock.address  : redis链接地址 如 redis://127.0.0.1:6379
spring.klock.password : redis密码
spring.klock.database : redis数据索引
spring.klock.waitTime : 获取锁最长阻塞时间（默认：60，单位：秒）
spring.klock.leaseTime: 已获取锁后自动释放时间（默认：60，单位：秒）
spring.klock.cluster-server.node-addresses : redis集群配置 如 redis://127.0.0.1:7000,redis://127.0.0.1:7001,redis://127.0.0.1:7002
#spring.klock.address 和 spring.klock.cluster-server.node-addresses 选其一即可
```
> @Klock注解参数说明

@Klock可以标注四个参数，作用分别如下  
name：lock的name，对应redis的key值。默认为：类名+方法名  
lockType：锁的类型，目前支持（可重入锁，公平锁，读写锁）。默认为：可重入锁  
waitTime：获取锁最长等待时间。默认为：60s。同时也可通过spring.klock.waitTime统一配置  
leaseTime：获得锁后，自动释放锁的时间。默认为：60s。同时也可通过spring.klock.leaseTime统一配置  
lockTimeoutStrategy: 加锁超时的处理策略，可配置为不做处理、快速失败、阻塞等待的处理策略，默认策略为不做处理  

customLockTimeoutStrategy: 自定义加锁超时的处理策略，需指定自定义处理的方法的方法名，并保持入参一致  
releaseTimeoutStrategy: 释放锁时，持有的锁已超时的处理策略，可配置为不做处理、快速失败的处理策略，默认策略为不做处理  
customReleaseTimeoutStrategy: 自定义释放锁时，需指定自定义处理的方法的方法名，并保持入参一致

# 锁超时说明
因为基于redis实现分布式锁，如果使用不当，会在以下场景下遇到锁超时的问题：  
![锁超时处理逻辑](./doc/img/锁超时处理逻辑.jpg "锁超时处理逻辑.jpg")

加锁超时处理策略(**LockTimeoutStrategy**)：
- **NO_OPERATION** 不做处理，继续执行业务逻辑
- **FAIL_FAST** 快速失败，会抛出KlockTimeoutException
- **KEEP_ACQUIRE** 阻塞等待，一直阻塞，直到获得锁，但在太多的尝试后，会停止获取锁并报错，此时很有可能是发生了死锁。
- **自定义(customLockTimeoutStrategy)** 需指定自定义处理的方法的方法名，并保持入参一致，指定自定义处理方法后，会覆盖上述三种策略，且会拦截业务逻辑的运行。

释放锁时超时处理策略(**ReleaseTimeoutStrategy**)：
- **NO_OPERATION** 不做处理，继续执行业务逻辑
- **FAIL_FAST** 快速失败，会抛出KlockTimeoutException
- **自定义(customReleaseTimeoutStrategy)** 需指定自定义处理的方法的方法名，并保持入参一致，指定自定义处理方法后，会覆盖上述两种策略, 执行自定义处理方法时，业务逻辑已经执行完毕，会在方法返回前和throw异常前执行。

**希望使用者清楚的意识到，如果没有对加锁超时进行有效设置，那么设置释放锁时超时处理策略是没有意义的。**

*在测试模块中已集成锁超时策略的使用用例*
# 关于测试
`tests` 目录下为分布式锁的测试模块，可以快速体验分布式锁的效果。测试需要一个可用的 redis：

```bash
docker run -d -p 6379:6379 redis:7-alpine
npm install
npm test          # 完整用例，约 8 分钟（其中多个用例按原样保留了 60 秒的持锁等待）
npm run coverage  # 带覆盖率
npm run build     # 编译到 dist/
npm run lint      # eslint
```

测试会依次尝试 `SPRING_KLOCK_ADDRESS`、`application.properties` 中的地址，以及本机常见地址，使用第一个能 PING 通的 redis。

# 使用登记
如果这个项目解决了你的实际问题，可在 https://gitee.com/kekingcn/spring-boot-klock-starter/issues/IH4NE 登记下，如果节省了你的研发时间，也愿意支持下的话，可点击下方【捐助】请作者喝杯咖啡，也是非常感谢
