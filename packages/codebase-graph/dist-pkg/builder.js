import fs from "node:fs";
import path from "node:path";
import { Node, Project, ScriptTarget, ModuleResolutionKind, SyntaxKind, } from "ts-morph";
import { CodebaseGraph } from "./graph";
import { relativePath, safeNodeId } from "./utils/path";
import { scanWorkspace } from "./workspace/discovery";
import { scanPackageFiles } from "./workspace/files";
function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function createProject(tsconfigPath) {
    if (tsconfigPath && fs.existsSync(tsconfigPath)) {
        return new Project({
            tsConfigFilePath: tsconfigPath,
            skipAddingFilesFromTsConfig: false,
            skipFileDependencyResolution: true,
        });
    }
    return new Project({
        compilerOptions: {
            allowJs: true,
            noEmit: true,
            moduleResolution: ModuleResolutionKind.Bundler,
            target: ScriptTarget.ES2022,
        },
        skipFileDependencyResolution: true,
    });
}
function locationKey(filePath, start) {
    return `${filePath}:${start}`;
}
function getNodeLocation(node, fileId, filePath) {
    const lineAndColumn = node
        .getSourceFile()
        .getLineAndColumnAtPos(node.getStart());
    return {
        fileId,
        filePath,
        line: lineAndColumn.line,
        column: lineAndColumn.column,
    };
}
function parseAliasMappings(tsconfigPath) {
    if (!tsconfigPath || !fs.existsSync(tsconfigPath)) {
        return [];
    }
    const tsconfig = readJson(tsconfigPath);
    const paths = tsconfig.compilerOptions?.paths;
    if (!paths) {
        return [];
    }
    const tsconfigDir = path.dirname(tsconfigPath);
    return Object.entries(paths).map(([pattern, targets]) => ({
        pattern,
        targets,
        tsconfigDir,
    }));
}
function resolveWithExtensions(basePath) {
    const candidates = [
        basePath,
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.jsx`,
        `${basePath}.mts`,
        `${basePath}.cts`,
        path.join(basePath, "index.ts"),
        path.join(basePath, "index.tsx"),
        path.join(basePath, "index.js"),
        path.join(basePath, "index.jsx"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return undefined;
}
function resolveAliasImport(importPath, aliases) {
    for (const alias of aliases) {
        const wildcardIndex = alias.pattern.indexOf("*");
        if (wildcardIndex === -1) {
            if (alias.pattern !== importPath) {
                continue;
            }
            for (const target of alias.targets) {
                const resolved = resolveWithExtensions(path.resolve(alias.tsconfigDir, target));
                if (resolved) {
                    return resolved;
                }
            }
            continue;
        }
        const prefix = alias.pattern.slice(0, wildcardIndex);
        const suffix = alias.pattern.slice(wildcardIndex + 1);
        if (!importPath.startsWith(prefix) || !importPath.endsWith(suffix)) {
            continue;
        }
        const wildcardValue = importPath.slice(prefix.length, importPath.length - suffix.length);
        for (const target of alias.targets) {
            const mapped = target.replace("*", wildcardValue);
            const resolved = resolveWithExtensions(path.resolve(alias.tsconfigDir, mapped));
            if (resolved) {
                return resolved;
            }
        }
    }
    return undefined;
}
function resolveImportPath(importerFilePath, importPath, pkg) {
    if (importPath.startsWith(".")) {
        return resolveWithExtensions(path.resolve(path.dirname(importerFilePath), importPath));
    }
    return resolveAliasImport(importPath, pkg.aliases);
}
function createBuildContext(options) {
    const scan = scanWorkspace(options.rootPath);
    const graph = new CodebaseGraph(scan.workspace);
    const packages = scan.packages.map((pkg) => ({
        pkg,
        files: scanPackageFiles(pkg),
        aliases: parseAliasMappings(pkg.tsconfigPath),
    }));
    return {
        graph,
        workspaceId: scan.workspace.id,
        workspaceRootPath: scan.workspace.rootPath,
        packages,
        packageByName: new Map(packages.map((entry) => [entry.pkg.name, entry])),
        fileNodeByPath: new Map(),
        declarationNodeByLocation: new Map(),
    };
}
function addContainsEdge(context, from, to) {
    context.graph.addEdge({
        id: safeNodeId(["edge", "contains", from, to]),
        kind: "contains",
        from,
        to,
        workspaceId: context.workspaceId,
    });
}
function addWorkspaceAndPackageNodes(context) {
    const workspace = context.graph.getWorkspace();
    context.graph.addNode({
        id: workspace.id,
        kind: "workspace",
        name: workspace.name,
        workspaceId: workspace.id,
        filePath: workspace.rootPath,
    });
    for (const pkgContext of context.packages) {
        const pkg = pkgContext.pkg;
        context.graph.addNode({
            id: pkg.id,
            kind: "package",
            name: pkg.name,
            workspaceId: workspace.id,
            packageId: pkg.id,
            filePath: pkg.rootPath,
            metadata: {
                packageJsonPath: pkg.packageJsonPath,
            },
        });
        addContainsEdge(context, workspace.id, pkg.id);
    }
}
function addFileNodes(context) {
    for (const pkgContext of context.packages) {
        for (const file of pkgContext.files) {
            const fileId = safeNodeId([
                "file",
                pkgContext.pkg.name,
                relativePath(context.workspaceRootPath, file.absolutePath),
            ]);
            const node = {
                id: fileId,
                kind: "file",
                name: path.basename(file.absolutePath),
                workspaceId: context.workspaceId,
                packageId: pkgContext.pkg.id,
                fileId,
                filePath: file.absolutePath,
                fileType: file.type,
                metadata: {
                    extension: file.extension,
                    relativePath: file.relativePath,
                },
            };
            context.graph.addNode(node);
            context.fileNodeByPath.set(file.absolutePath, node);
            addContainsEdge(context, pkgContext.pkg.id, fileId);
        }
    }
}
function parsePackageSources(pkgContext) {
    const project = createProject(pkgContext.pkg.tsconfigPath);
    const sourceFiles = [];
    for (const file of pkgContext.files) {
        if (!file.isCodeFile) {
            continue;
        }
        const sourceFile = project.addSourceFileAtPathIfExists(file.absolutePath);
        if (sourceFile) {
            sourceFiles.push(sourceFile);
        }
    }
    return sourceFiles;
}
function getPackageContextForFile(context, sourceFilePath) {
    return context.packages.find((entry) => sourceFilePath.startsWith(entry.pkg.rootPath));
}
function getFileNode(context, sourceFilePath) {
    return context.fileNodeByPath.get(sourceFilePath);
}
function declarationStart(node) {
    return node.getStart();
}
function declarationName(node) {
    if (Node.isMethodDeclaration(node)) {
        return node.getName();
    }
    if (Node.isFunctionDeclaration(node) ||
        Node.isVariableDeclaration(node) ||
        Node.isClassDeclaration(node) ||
        Node.isInterfaceDeclaration(node) ||
        Node.isTypeAliasDeclaration(node)) {
        return node.getName() ?? "anonymous";
    }
    return "unknown";
}
function isExportedDeclaration(node) {
    if (Node.isFunctionDeclaration(node) ||
        Node.isClassDeclaration(node) ||
        Node.isInterfaceDeclaration(node) ||
        Node.isTypeAliasDeclaration(node)) {
        return node.isExported();
    }
    if (Node.isMethodDeclaration(node)) {
        const cls = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
        return Boolean(cls?.isExported());
    }
    if (Node.isVariableDeclaration(node)) {
        return node.getVariableStatement()?.isExported() ?? false;
    }
    return false;
}
function getFunctionNodeSignature(node) {
    const signature = node.getSignature();
    const declaration = signature?.getDeclaration();
    if (declaration) {
        const text = declaration.getText();
        const bodyIndex = text.indexOf("{");
        return bodyIndex > 0 ? text.slice(0, bodyIndex).trim() : text;
    }
    return node.getText();
}
function createDeclarationGraphNode(context, declaration, kind, nameOverride) {
    const sourceFilePath = declaration.getSourceFile().getFilePath();
    const fileNode = getFileNode(context, sourceFilePath);
    const pkgContext = getPackageContextForFile(context, sourceFilePath);
    if (!fileNode || !pkgContext) {
        return undefined;
    }
    const name = nameOverride ?? declarationName(declaration);
    const nodeId = safeNodeId([
        kind,
        pkgContext.pkg.name,
        relativePath(context.workspaceRootPath, sourceFilePath),
        name,
        String(declarationStart(declaration)),
    ]);
    const graphNode = {
        id: nodeId,
        kind,
        name,
        workspaceId: context.workspaceId,
        packageId: pkgContext.pkg.id,
        fileId: fileNode.id,
        filePath: sourceFilePath,
        isExported: isExportedDeclaration(declaration),
        location: getNodeLocation(declaration, fileNode.id, sourceFilePath),
    };
    if (Node.isFunctionDeclaration(declaration) ||
        Node.isMethodDeclaration(declaration)) {
        graphNode.signature = getFunctionNodeSignature(declaration);
        graphNode.returnType = declaration.getReturnType().getText();
        graphNode.parameters = declaration.getParameters().map((parameter) => ({
            name: parameter.getName(),
            type: parameter.getType().getText(),
        }));
    }
    context.graph.addNode(graphNode);
    context.graph.addEdge({
        id: safeNodeId(["edge", "contains", fileNode.id, graphNode.id]),
        kind: "contains",
        from: fileNode.id,
        to: graphNode.id,
        workspaceId: context.workspaceId,
        packageId: fileNode.packageId,
    });
    context.declarationNodeByLocation.set(locationKey(sourceFilePath, declarationStart(declaration)), graphNode);
    return graphNode;
}
function extractDeclarations(context, sourceFile) {
    for (const fn of sourceFile.getFunctions()) {
        if (!fn.getName()) {
            continue;
        }
        createDeclarationGraphNode(context, fn, "function");
    }
    for (const cls of sourceFile.getClasses()) {
        const className = cls.getName();
        if (!className) {
            continue;
        }
        createDeclarationGraphNode(context, cls, "class");
        for (const method of cls.getMethods()) {
            createDeclarationGraphNode(context, method, "method", `${className}.${method.getName()}`);
        }
    }
    for (const iface of sourceFile.getInterfaces()) {
        createDeclarationGraphNode(context, iface, "interface");
    }
    for (const alias of sourceFile.getTypeAliases()) {
        createDeclarationGraphNode(context, alias, "typeAlias");
    }
    for (const statement of sourceFile.getVariableStatements()) {
        for (const declaration of statement.getDeclarations()) {
            const initializer = declaration.getInitializer();
            if (initializer &&
                (Node.isArrowFunction(initializer) ||
                    Node.isFunctionExpression(initializer))) {
                const fnNode = createDeclarationGraphNode(context, declaration, "function");
                if (fnNode) {
                    context.declarationNodeByLocation.set(locationKey(sourceFile.getFilePath(), initializer.getStart()), fnNode);
                }
                continue;
            }
            createDeclarationGraphNode(context, declaration, "variable");
        }
    }
}
function resolveDeclarationByNode(context, node) {
    if (!node) {
        return undefined;
    }
    return context.declarationNodeByLocation.get(locationKey(node.getSourceFile().getFilePath(), node.getStart()));
}
function resolveDeclarationBySymbol(context, symbol) {
    if (!symbol) {
        return undefined;
    }
    for (const declaration of symbol.getDeclarations()) {
        const found = resolveDeclarationByNode(context, declaration);
        if (found) {
            return found;
        }
    }
    return undefined;
}
function getEnclosingExecutableDeclaration(context, node) {
    const executable = node.getFirstAncestor((candidate) => {
        return (Node.isFunctionDeclaration(candidate) ||
            Node.isMethodDeclaration(candidate) ||
            Node.isArrowFunction(candidate) ||
            Node.isFunctionExpression(candidate));
    });
    if (!executable) {
        return undefined;
    }
    return resolveDeclarationByNode(context, executable);
}
function addImportEdges(context, sourceFile, pkgContext) {
    const sourceFilePath = sourceFile.getFilePath();
    const fromFileNode = getFileNode(context, sourceFilePath);
    if (!fromFileNode) {
        return;
    }
    for (const importDecl of sourceFile.getImportDeclarations()) {
        const importPath = importDecl.getModuleSpecifierValue();
        const resolvedPath = resolveImportPath(sourceFilePath, importPath, pkgContext);
        const targetFileNode = resolvedPath
            ? context.fileNodeByPath.get(resolvedPath)
            : undefined;
        if (targetFileNode) {
            context.graph.addEdge({
                id: safeNodeId([
                    "edge",
                    "imports",
                    fromFileNode.id,
                    targetFileNode.id,
                    String(importDecl.getStart()),
                ]),
                kind: "imports",
                from: fromFileNode.id,
                to: targetFileNode.id,
                workspaceId: context.workspaceId,
                packageId: fromFileNode.packageId,
                isCrossPackage: fromFileNode.packageId !== targetFileNode.packageId,
                location: getNodeLocation(importDecl, fromFileNode.id, sourceFilePath),
                metadata: { importPath },
            });
            continue;
        }
        const targetPackage = context.packageByName.get(importPath);
        if (targetPackage && targetPackage.pkg.id !== fromFileNode.packageId) {
            context.graph.addEdge({
                id: safeNodeId([
                    "edge",
                    "crossPackageDependency",
                    String(fromFileNode.packageId),
                    targetPackage.pkg.id,
                    importPath,
                    String(importDecl.getStart()),
                ]),
                kind: "crossPackageDependency",
                from: String(fromFileNode.packageId),
                to: targetPackage.pkg.id,
                workspaceId: context.workspaceId,
                packageId: fromFileNode.packageId,
                isCrossPackage: true,
                location: getNodeLocation(importDecl, fromFileNode.id, sourceFilePath),
                metadata: {
                    toPackageName: importPath,
                    viaFileId: fromFileNode.id,
                    importPath,
                },
            });
            continue;
        }
        context.graph.addEdge({
            id: safeNodeId([
                "edge",
                "imports",
                fromFileNode.id,
                fromFileNode.id,
                importPath,
                String(importDecl.getStart()),
            ]),
            kind: "imports",
            from: fromFileNode.id,
            to: fromFileNode.id,
            workspaceId: context.workspaceId,
            packageId: fromFileNode.packageId,
            isExternal: true,
            location: getNodeLocation(importDecl, fromFileNode.id, sourceFilePath),
            metadata: {
                importPath,
                external: true,
            },
        });
    }
}
function resolveCallTarget(context, callExpression) {
    const expression = callExpression.getExpression();
    const symbol = expression.getSymbol();
    const direct = resolveDeclarationBySymbol(context, symbol);
    if (direct) {
        return direct;
    }
    const typeSymbol = expression.getType().getSymbol();
    return resolveDeclarationBySymbol(context, typeSymbol);
}
function addCallEdges(context, sourceFile) {
    const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
        const caller = getEnclosingExecutableDeclaration(context, call);
        if (!caller) {
            continue;
        }
        const callee = resolveCallTarget(context, call);
        if (!callee) {
            continue;
        }
        context.graph.addEdge({
            id: safeNodeId([
                "edge",
                "calls",
                caller.id,
                callee.id,
                String(call.getStart()),
            ]),
            kind: "calls",
            from: caller.id,
            to: callee.id,
            workspaceId: context.workspaceId,
            packageId: caller.packageId,
            isCrossPackage: caller.packageId !== callee.packageId,
            location: getNodeLocation(call, caller.fileId ?? "", sourceFile.getFilePath()),
        });
    }
}
function addVariableUsageEdges(context, sourceFile) {
    const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier);
    for (const identifier of identifiers) {
        const owner = getEnclosingExecutableDeclaration(context, identifier);
        if (!owner) {
            continue;
        }
        const symbol = identifier.getSymbol();
        const declaration = resolveDeclarationBySymbol(context, symbol);
        if (!declaration || declaration.kind !== "variable") {
            continue;
        }
        context.graph.addEdge({
            id: safeNodeId([
                "edge",
                "usesVariable",
                owner.id,
                declaration.id,
                String(identifier.getStart()),
            ]),
            kind: "usesVariable",
            from: owner.id,
            to: declaration.id,
            workspaceId: context.workspaceId,
            packageId: owner.packageId,
            isCrossPackage: owner.packageId !== declaration.packageId,
            location: getNodeLocation(identifier, owner.fileId ?? declaration.fileId ?? "", sourceFile.getFilePath()),
        });
    }
}
function addClassInheritanceEdges(context, cls) {
    const classNode = resolveDeclarationByNode(context, cls);
    if (!classNode) {
        return;
    }
    const baseClass = cls.getBaseClass();
    if (baseClass) {
        const target = resolveDeclarationByNode(context, baseClass);
        if (target) {
            context.graph.addEdge({
                id: safeNodeId([
                    "edge",
                    "extends",
                    classNode.id,
                    target.id,
                    String(cls.getStart()),
                ]),
                kind: "extends",
                from: classNode.id,
                to: target.id,
                workspaceId: context.workspaceId,
                packageId: classNode.packageId,
                isCrossPackage: classNode.packageId !== target.packageId,
                location: getNodeLocation(cls, classNode.fileId ?? target.fileId ?? "", cls.getSourceFile().getFilePath()),
            });
        }
    }
    for (const impl of cls.getImplements()) {
        const target = resolveDeclarationBySymbol(context, impl.getExpression().getSymbol());
        if (!target) {
            continue;
        }
        context.graph.addEdge({
            id: safeNodeId([
                "edge",
                "implements",
                classNode.id,
                target.id,
                String(impl.getStart()),
            ]),
            kind: "implements",
            from: classNode.id,
            to: target.id,
            workspaceId: context.workspaceId,
            packageId: classNode.packageId,
            isCrossPackage: classNode.packageId !== target.packageId,
            location: getNodeLocation(impl, classNode.fileId ?? target.fileId ?? "", cls.getSourceFile().getFilePath()),
        });
    }
}
function addInterfaceExtendsEdges(context, iface) {
    const interfaceNode = resolveDeclarationByNode(context, iface);
    if (!interfaceNode) {
        return;
    }
    for (const ext of iface.getExtends()) {
        const target = resolveDeclarationBySymbol(context, ext.getExpression().getSymbol());
        if (!target) {
            continue;
        }
        context.graph.addEdge({
            id: safeNodeId([
                "edge",
                "extends",
                interfaceNode.id,
                target.id,
                String(ext.getStart()),
            ]),
            kind: "extends",
            from: interfaceNode.id,
            to: target.id,
            workspaceId: context.workspaceId,
            packageId: interfaceNode.packageId,
            isCrossPackage: interfaceNode.packageId !== target.packageId,
            location: getNodeLocation(ext, interfaceNode.fileId ?? target.fileId ?? "", iface.getSourceFile().getFilePath()),
        });
    }
}
function findTypeOwnerNode(context, typeRef) {
    const owner = typeRef.getFirstAncestor((candidate) => {
        return (Node.isFunctionDeclaration(candidate) ||
            Node.isMethodDeclaration(candidate) ||
            Node.isClassDeclaration(candidate) ||
            Node.isInterfaceDeclaration(candidate) ||
            Node.isTypeAliasDeclaration(candidate));
    });
    return resolveDeclarationByNode(context, owner ?? undefined);
}
function addTypeReferenceEdges(context, sourceFile) {
    for (const typeRef of sourceFile.getDescendantsOfKind(SyntaxKind.TypeReference)) {
        const ownerNode = findTypeOwnerNode(context, typeRef);
        if (!ownerNode) {
            continue;
        }
        const target = resolveDeclarationBySymbol(context, typeRef.getTypeName().getSymbol());
        if (!target) {
            continue;
        }
        context.graph.addEdge({
            id: safeNodeId([
                "edge",
                "typeReference",
                ownerNode.id,
                target.id,
                String(typeRef.getStart()),
            ]),
            kind: "typeReference",
            from: ownerNode.id,
            to: target.id,
            workspaceId: context.workspaceId,
            packageId: ownerNode.packageId,
            isCrossPackage: ownerNode.packageId !== target.packageId,
            location: getNodeLocation(typeRef, ownerNode.fileId ?? target.fileId ?? "", sourceFile.getFilePath()),
        });
    }
}
function addTypeAndInheritanceEdges(context, sourceFile) {
    for (const cls of sourceFile.getClasses()) {
        addClassInheritanceEdges(context, cls);
    }
    for (const iface of sourceFile.getInterfaces()) {
        addInterfaceExtendsEdges(context, iface);
    }
    addTypeReferenceEdges(context, sourceFile);
}
export function buildCodebaseGraph(options) {
    const context = createBuildContext(options);
    addWorkspaceAndPackageNodes(context);
    addFileNodes(context);
    for (const pkgContext of context.packages) {
        const sourceFiles = parsePackageSources(pkgContext);
        for (const sourceFile of sourceFiles) {
            addImportEdges(context, sourceFile, pkgContext);
            extractDeclarations(context, sourceFile);
        }
        for (const sourceFile of sourceFiles) {
            addCallEdges(context, sourceFile);
            addVariableUsageEdges(context, sourceFile);
            addTypeAndInheritanceEdges(context, sourceFile);
        }
    }
    return { graph: context.graph };
}
