// 自适应正则脚本
// 功能：AI输出完成后，检测最后一层聊天存在的表达式，将匹配的 scriptName 存入变量并排序
// 加载脚本/变量变化时，检查角色卡正则列表与变量列表，注册缺失的正则
// 卸载脚本时，根据列表卸载对应的正则
// 使用防抖机制（500ms）防止无限循环

// regex.json 网络链接列表（主URL + 备用CDN加速URL）
const REGEX_JSON_URLS = [
  'https://cdn.jsdelivr.net/gh/AkabaneSaki/myrepo@main/AutoDialogueBeautifier/regex.json',
  'https://gcore.jsdelivr.net/gh/AkabaneSaki/myrepo@main/AutoDialogueBeautifier/regex.json',
  'https://testingcf.jsdelivr.net/gh/AkabaneSaki/myrepo@main/AutoDialogueBeautifier/regex.json',
];

$(async () => {
  console.info('自适应正则脚本已加载');

  // ========== 加载网络 regex.json（支持备用CDN） ==========
  let regexData: any[] = [];
  try {
    console.info('自适应正则: 正在从网络加载 regex.json...');
    let loaded = false;

    for (let i = 0; i < REGEX_JSON_URLS.length; i++) {
      const url = REGEX_JSON_URLS[i];
      try {
        console.info(`自适应正则: 尝试从第 ${i + 1} 个URL加载: ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        regexData = await response.json();
        console.info(`自适应正则: 成功从第 ${i + 1} 个URL加载 ${regexData.length} 条规则`);
        loaded = true;
        break;
      } catch (urlError) {
        console.warn(`自适应正则: 第 ${i + 1} 个URL加载失败:`, urlError);
        if (i < REGEX_JSON_URLS.length - 1) {
          console.info('自适应正则: 尝试下一个备用URL...');
        }
      }
    }

    if (!loaded) {
      throw new Error('所有CDN URL均加载失败');
    }
  } catch (error) {
    console.error('自适应正则: 从网络加载失败:', error);
    toastr.error('自适应正则: 加载规则失败，请检查网络连接');
    return; // 加载失败时退出
  }

  // 聊天变量键名 - 存储当前应该注册的正则 scriptName 列表
  const VARIABLE_KEY = 'adaptive_regex_names';
  // 聊天变量键名 - 存储最后处理的消息ID
  const LAST_PROCESSED_MESSAGE_ID_KEY = 'adaptive_regex_last_message_id';

  // 同步锁，防止无限循环
  let isSyncing = false;
  // 上次处理的聊天ID，用于防抖
  let lastChatId: string | null = null;
  // 防抖定时器
  let syncTimeout: ReturnType<typeof setTimeout> | null = null;

  // ========== 缓存机制 ==========
  // 缓存编译后的正则 patterns，避免每次消息都重新解析
  let cachedPatterns: { scriptName: string; pattern: RegExp; quickCheck: string }[] | null = null;
  // 缓存启用的正则规则
  let cachedEnabledRules: TavernRegex[] | null = null;

  // 清除缓存（用于 regex.json 更新时）
  const clearCache = (): void => {
    cachedPatterns = null;
    cachedEnabledRules = null;
    console.info('自适应正则: 缓存已清除');
  };

  console.info(`自适应正则: 成功加载 ${regexData.length} 条规则`);

  // 从 regex.json 中获取有效的正则规则（带缓存）
  const getEnabledRegexRules = (): TavernRegex[] => {
    if (cachedEnabledRules !== null) {
      return cachedEnabledRules;
    }
    cachedEnabledRules = regexData
      .filter((rule: any) => !rule.disabled)
      .map((rule: any) => ({
        id: rule.id,
        script_name: rule.scriptName,
        enabled: true,
        scope: 'character' as const,
        find_regex: rule.findRegex,
        replace_string: rule.replaceString,
        trim_strings: Array.isArray(rule.trimStrings) ? rule.trimStrings.join('\n') : '',
        source: {
          user_input: false,
          ai_output: true,
          slash_command: false,
          world_info: false,
        },
        destination: {
          display: true,
          prompt: false,
        },
        run_on_edit: rule.runOnEdit ?? true,
        min_depth: rule.minDepth ?? null,
        max_depth: rule.maxDepth ?? 10,
      }));
    return cachedEnabledRules;
  };

  // 从 regex.json 提取检测模式（带缓存，避免每次消息都重新解析）
  const extractDetectionPatterns = (): { scriptName: string; pattern: RegExp; quickCheck: string }[] => {
    // 直接返回缓存，避免重复计算
    if (cachedPatterns !== null) {
      return cachedPatterns;
    }

    // 计算并缓存结果
    const result = regexData
      .filter((rule: any) => !rule.disabled)
      .map((rule: any) => {
        let patternStr = rule.findRegex;

        // 解析正则表达式，去除可能的 /pattern/flags 格式
        const match = patternStr.match(/^\/(.+)\/([gimsuy]*)$/);
        if (match) {
          patternStr = match[1];
        }

        try {
          const pattern = new RegExp(patternStr, 'i');

          let quickCheck = '';
          if (patternStr.includes('{') || patternStr.includes('\\{')) {
            quickCheck = '{';
          } else if (patternStr.includes('<') || patternStr.includes('\\<')) {
            const tagMatch = patternStr.match(/<(\w+)/);
            if (tagMatch) {
              quickCheck = `<${tagMatch[1]}`;
            }
          } else if (patternStr.includes('\\[') || patternStr.includes('\\]')) {
            quickCheck = '[';
          } else if (patternStr.includes('\\(') || patternStr.includes('\\)')) {
            quickCheck = '(';
          } else if (patternStr.startsWith('>')) {
            quickCheck = '>';
          } else if (patternStr.startsWith('<')) {
            const firstTagMatch = patternStr.match(/<(\w+)/);
            if (firstTagMatch) {
              quickCheck = `<${firstTagMatch[1]}`;
            }
          } else {
            quickCheck = patternStr.substring(0, Math.min(15, patternStr.length));
          }

          return {
            scriptName: rule.scriptName,
            pattern,
            quickCheck,
          };
        } catch (e) {
          console.warn(`无效的正则表达式: ${patternStr}`, e);
          return null;
        }
      })
      .filter(Boolean) as { scriptName: string; pattern: RegExp; quickCheck: string }[];

    // 存入缓存并返回
    cachedPatterns = result;
    return result;
  };

  // 检测消息中包含的需要处理的正则 scriptName
  // skipStoredNames: 已存储的正则名称列表，跳过这些正则的匹配检测
  const detectNeededScriptNames = (messageContent: string, skipStoredNames: string[] = []): string[] => {
    if (!messageContent || messageContent.length < 3) {
      return [];
    }

    const patterns = extractDetectionPatterns();
    const neededNames: string[] = [];
    const skipSet = new Set(skipStoredNames);

    for (const { scriptName, pattern, quickCheck } of patterns) {
      // 跳过已存储的正则（它们已经匹配过了，不需要再次检测）
      if (skipSet.has(scriptName)) {
        continue;
      }

      // 快速预检查
      if (quickCheck && !messageContent.includes(quickCheck)) {
        continue;
      }

      try {
        pattern.lastIndex = 0;
        if (pattern.test(messageContent)) {
          neededNames.push(scriptName);
          console.info(`自适应正则: 检测到 ${scriptName}`);
        }
      } catch (e) {
        // 忽略正则测试错误
      }
    }

    return neededNames;
  };

  // 获取聊天变量中存储的正则名称列表
  const getStoredRegexNames = (): string[] => {
    try {
      const chatVars = getVariables({ type: 'chat' });
      const stored = chatVars?.[VARIABLE_KEY];
      if (Array.isArray(stored)) {
        return stored.filter((item): item is string => typeof item === 'string');
      }
    } catch (e) {
      console.warn('获取存储的正则名称失败:', e);
    }
    return [];
  };

  // 保存正则名称列表到聊天变量（排序后）
  const saveStoredRegexNames = (names: string[]): void => {
    try {
      // 排序保证一致性
      const sortedNames = [...names].sort();
      insertOrAssignVariables({ [VARIABLE_KEY]: sortedNames }, { type: 'chat' });
      console.info(`自适应正则: 已保存 ${sortedNames.length} 个正则名称到聊天变量`);
    } catch (e) {
      console.warn('保存正则名称失败:', e);
    }
  };

  // 获取角色卡当前已注册的所有正则 scriptName
  const getCharacterCardRegexNames = async (): Promise<Set<string>> => {
    const names = new Set<string>();
    try {
      const regexes = await updateTavernRegexesWith((regexes: TavernRegex[]) => {
        regexes.forEach(r => names.add(r.script_name));
        return regexes;
      });
    } catch (e) {
      console.warn('获取角色卡正则列表失败:', e);
    }
    return names;
  };

  // 注册单个正则规则
  const registerRegexRule = async (rule: TavernRegex): Promise<void> => {
    try {
      await updateTavernRegexesWith((regexes: TavernRegex[]) => {
        // 避免重复注册同名正则
        const filtered = regexes.filter((r: TavernRegex) => r.script_name !== rule.script_name);
        return [...filtered, rule];
      });
    } catch (e) {
      console.warn(`注册正则失败: ${rule.script_name}`, e);
    }
  };

  // 同步正则列表：对比变量列表和角色卡正则列表
  // - 移除：存在于角色卡正则列表但不在变量列表中的正则
  // - 注册：存在于变量列表但不在角色卡正则列表中的正则
  const syncRegexWithVariable = async (): Promise<void> => {
    // 防止重复调用
    if (isSyncing) {
      console.info('自适应正则: 正在同步中，跳过本次调用');
      return;
    }

    try {
      isSyncing = true;

      const variableNames = getStoredRegexNames();
      const variableSet = new Set(variableNames);
      const characterCardNames = await getCharacterCardRegexNames();
      const characterSet = new Set(characterCardNames);

      // 获取所有启用状态的 regex.json 规则名称（用于判断是否应该移除）
      const enabledRegexNames = new Set(getEnabledRegexRules().map(r => r.script_name));

      // 找出需要移除的正则（同时满足两个条件：1. 在regex.json中启用 2. 不在变量列表中）
      const toRemove: string[] = [];
      for (const name of characterCardNames) {
        // 只有当该正则是在regex.json中启用着的，且不在变量列表中时才移除
        if (!variableSet.has(name) && enabledRegexNames.has(name)) {
          toRemove.push(name);
        }
      }

      // 找出需要注册的正则（在变量中但不在角色卡中）
      const toRegister: string[] = [];
      for (const name of variableNames) {
        if (!characterSet.has(name)) {
          toRegister.push(name);
        }
      }

      // 执行移除
      if (toRemove.length > 0) {
        await removeRegexByNames(toRemove);
        console.info(`自适应正则: 已移除 ${toRemove.length} 条不在变量列表中的规则: ${toRemove.join(', ')}`);
      }

      // 执行注册
      if (toRegister.length > 0) {
        const allRules = getEnabledRegexRules();
        let registeredCount = 0;
        for (const name of toRegister) {
          const rule = allRules.find(r => r.script_name === name);
          if (rule) {
            await registerRegexRule(rule);
            registeredCount++;
            console.info(`自适应正则: 已注册 ${name}`);
          }
        }
        if (registeredCount > 0) {
          console.info(`自适应正则: 共注册了 ${registeredCount} 条规则`);
        }
      }

      if (toRemove.length === 0 && toRegister.length === 0) {
        console.info('自适应正则: 变量列表与角色卡正则列表已同步，无需更新');
      }
    } catch (e) {
      console.error('同步正则列表失败:', e);
    } finally {
      isSyncing = false;
    }
  };

  // 移除指定名称的正则
  const removeRegexByNames = async (names: string[]): Promise<void> => {
    if (names.length === 0) return;

    try {
      await updateTavernRegexesWith((regexes: TavernRegex[]) => {
        return regexes.filter((r: TavernRegex) => !names.includes(r.script_name));
      });
      console.info(`自适应正则: 已移除 ${names.length} 条规则`);
    } catch (e) {
      console.warn('移除正则失败:', e);
    }
  };

  // 扫描最后一层消息并更新变量
  const scanAndUpdateVariable = async (): Promise<void> => {
    try {
      console.info('自适应正则: 开始扫描最后一层消息');

      const messages = getChatMessages(-1); // 获取最后一条消息
      console.info('自适应正则: 获取到的消息:', messages);

      if (!messages || messages.length === 0) {
        console.info('自适应正则: 没有找到消息，返回');
        return;
      }

      const lastMessage = messages[0];
      const messageContent = lastMessage.message;
      console.info('自适应正则: 消息内容:', messageContent);

      // 获取已存储的名称，用于跳过检测
      const storedNames = getStoredRegexNames();
      console.info('自适应正则: 已存储的正则名称:', storedNames);

      // 检测需要的正则名称（跳过已存储的正则）
      const detectedNames = detectNeededScriptNames(messageContent, storedNames);
      console.info('自适应正则: 检测到的新正则名称:', detectedNames);

      // 合并并去重
      const combinedNames = [...new Set([...storedNames, ...detectedNames])];
      console.info('自适应正则: 合并后的正则名称:', combinedNames);

      // 如果有变化，保存并同步
      const storedSorted = [...storedNames].sort().join(',');
      const combinedSorted = [...combinedNames].sort().join(',');
      console.info('自适应正则: 排序后的存储名称:', storedSorted);
      console.info('自适应正则: 排序后的合并名称:', combinedSorted);

      if (storedSorted !== combinedSorted) {
        console.info(`自适应正则: 检测到变化，从 ${storedNames.length} 个更新到 ${combinedNames.length} 个`);
        saveStoredRegexNames(combinedNames);
        await syncRegexWithVariable();
      } else {
        console.info('自适应正则: 无变化，不更新');
      }
    } catch (e) {
      console.error('扫描消息更新变量失败:', e);
    }
  };

  // 初始化：根据变量中的列表注册缺失的正则
  const initializeFromVariable = async (): Promise<void> => {
    const storedNames = getStoredRegexNames();
    if (storedNames.length > 0) {
      console.info(`自适应正则: 初始化，从变量加载 ${storedNames.length} 个正则`);
      await syncRegexWithVariable();
    } else {
      // 如果变量为空，扫描当前消息
      console.info('自适应正则: 变量为空，扫描当前消息');
      await scanAndUpdateVariable();
    }
  };

  // 监听变量变化的事件回调
  let previousStoredNames: string[] = [];

  const watchVariableChange = (): void => {
    // 初始记录
    previousStoredNames = getStoredRegexNames();

    // 重写 replaceVariables 函数来监听变量变化
    const originalReplaceVariables = replaceVariables;
    (window as any).replaceVariables = function (variables: Record<string, any>, option: any) {
      const result = originalReplaceVariables.call(this, variables, option);

      // 检查是否是聊天变量发生变化，且不在同步中
      if (!isSyncing && (option?.type === 'chat' || !option)) {
        const currentStoredNames = getStoredRegexNames();
        const currentSorted = [...currentStoredNames].sort().join(',');
        const previousSorted = [...previousStoredNames].sort().join(',');

        if (currentSorted !== previousSorted) {
          console.info(`自适应正则: 变量发生变化，刷新正则列表`);
          // 使用防抖，避免频繁触发
          if (syncTimeout) {
            clearTimeout(syncTimeout);
          }
          syncTimeout = setTimeout(() => {
            syncRegexWithVariable().then(() => {
              previousStoredNames = getStoredRegexNames();
            });
          }, 500);
        }
      }

      return result;
    };
  };

  // 监听新消息事件（AI输出完成时）
  eventOn(tavern_events.MESSAGE_RECEIVED, async (messageId: number) => {
    // 检查是否已经处理过此消息
    const lastProcessedId = getVariables({ type: 'chat' })[LAST_PROCESSED_MESSAGE_ID_KEY];
    if (lastProcessedId !== undefined && lastProcessedId !== null && String(lastProcessedId) === String(messageId)) {
      console.info(`自适应正则: 消息 ${messageId} 已处理过，跳过`);
      return;
    }

    console.info(`自适应正则: 收到新消息 ${messageId}，扫描最新楼层`);
    await scanAndUpdateVariable();

    // 更新最后处理的消息ID
    try {
      insertOrAssignVariables({ [LAST_PROCESSED_MESSAGE_ID_KEY]: messageId }, { type: 'chat' });
      console.info(`自适应正则: 已更新最后处理的消息ID为 ${messageId}`);
    } catch (e) {
      console.warn('更新最后处理的消息ID失败:', e);
    }
  });

  // 监听聊天切换事件（带防抖）
  eventOn(tavern_events.CHAT_CHANGED, async (chatFileName: string) => {
    console.info(`自适应正则: 检测到聊天切换到 ${chatFileName}`);

    // 忽略相同的聊天ID
    if (lastChatId === chatFileName) {
      return;
    }
    lastChatId = chatFileName;

    // 清除之前的定时器
    if (syncTimeout) {
      clearTimeout(syncTimeout);
    }

    // 防抖：延迟 500ms 执行同步
    syncTimeout = setTimeout(async () => {
      if (!isSyncing) {
        await syncRegexWithVariable();
      }
    }, 500);
  });

  // 卸载时移除所有本脚本注册的正则
  $(window).on('pagehide', async () => {
    const storedNames = getStoredRegexNames();
    if (storedNames.length > 0) {
      await removeRegexByNames(storedNames);
      console.info(`自适应正则: 已卸载 ${storedNames.length} 条规则`);
    }
    console.info('自适应正则脚本已卸载');
  });

  // 启动
  console.info('自适应正则: 启动初始化');
  await initializeFromVariable();
  watchVariableChange();

  const enabledRules = regexData.filter((r: any) => !r.disabled).length;
  console.info(`自适应正则: 准备了 ${enabledRules} 条规则用于检测`);
});
