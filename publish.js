/*global env: true */
'use strict';

const template = require('jsdoc/template');
const fs = require('jsdoc/fs');
const path = require('jsdoc/path');
const handle = require('jsdoc/util/error').handle;
const helper = require('jsdoc/util/templateHelper');
const htmlsafe = helper.htmlsafe;
const resolveAuthorLinks = helper.resolveAuthorLinks;

let data;
let view;
let outdir = env.opts.destination;

function find(spec) {
    return helper.find(data, spec).filter(isVisibleDoclet);
}

function isVisibleDoclet(doclet) {
    return !(doclet && typeof doclet.name === 'string' && doclet.name.charAt(0) === '_');
}

function filterMemberGroups(members) {
    Object.keys(members).forEach(function(key) {
        if (Array.isArray(members[key])) {
            members[key] = members[key].filter(isVisibleDoclet);
        }
    });

    return members;
}

function tutoriallink(tutorial) {
    return helper.toTutorial(tutorial, null, { tag: 'em', classname: 'disabled', prefix: 'Tutorial: ' });
}

function getAncestorLinks(doclet) {
    return helper.getAncestorLinks(data, doclet);
}

function hashToLink(doclet, hash) {
    if ( !/^(#.+)/.test(hash) ) { return hash; }
    
    let url = helper.createLink(doclet);
    
    url = url.replace(/(#.+|$)/, hash);
    return '<a href="' + url + '">' + hash + '</a>';
}

function mangleType(type) {
    let found;
    do {
        found = false;
        type = type.replace(/Array\.&lt;(.+)(?!(?:\/|<)\w+)>/g, function($0, $1) {
            found = true;
            return $1 + "[]";
        });
    } while (found);
    type = type.replace(/(Object|Promise)\.(?=&lt;)/g, '$1');
    return type;
}

function needsSignature(doclet) {
    // function and class definitions always get a signature
    if (doclet.kind === 'function' || doclet.kind === 'class') {
        return true;
    }
    // typedefs that contain functions get a signature, too
    if (doclet.kind === 'typedef' && doclet.type && doclet.type.names &&
        doclet.type.names.length) {
        return doclet.type.names.some(function(typeName) {
            return typeName.toLowerCase() === 'function';
        });
    }

    return false;
}

function addSignatureParams(f) {
    const params = helper.getSignatureParams(f, 'optional');
    
    f.signature = (f.signature || '') + '('+params.join(', ')+')';
}

function addSignatureReturns(f) {
    const returnTypes = helper.getSignatureReturns(f);
    
    f.signature = '<span class="signature">'+(f.signature || '') + '</span>';
    
    if (returnTypes.length) {
        const rtypes = returnTypes.map(mangleType);
        f.signature += '<span class="return-arrow" aria-hidden="true">&rarr;</span><span class="type-signature returnType">'+(rtypes.length ? '{ '+rtypes.join(' | ')+' }' : '')+'</span>';
    }
}

function addSignatureTypes(f) {
    const types = helper.getSignatureTypes(f);
    
    f.signature = (f.signature || '') + '<span class="type-signature">'+(types.length? ' :'+types.join('|') : '')+'</span>';
}

function addAttribs(f) {
    const attribs = helper.getAttribs(f);

    if (attribs.length) {
        if (attribs[0] === 'static')
            attribs.shift();
        if (attribs.length)
            f.attribs = '<span class="type-signature ' + (attribs[0] === 'static' ? 'static' : '') + '">' + htmlsafe(attribs.length ? attribs.join(',') : '') + '</span>';
    }    
}

function shortenPaths(files, commonPrefix) {
    // always use forward slashes
    const regexp = new RegExp('\\\\', 'g');

    Object.keys(files).forEach(function(file) {
        files[file].shortened = files[file].resolved.replace(commonPrefix, '')
            .replace(regexp, '/');
    });

    return files;
}

function resolveSourcePath(filepath) {
    return path.resolve(process.cwd(), filepath);
}

function getPathFromDoclet(doclet) {
    if (!doclet.meta) {
        return;
    }

    const filepath = doclet.meta.path && doclet.meta.path !== 'null' ?
        doclet.meta.path + '/' + doclet.meta.filename :
        doclet.meta.filename;

    return filepath;
}

function getReadmeBranch(opts) {
    if (opts.readmeBranch) {
        return opts.readmeBranch;
    }
    if (opts.repoBranch) {
        return opts.repoBranch;
    }
    if (opts.sourceRoot) {
        const match = opts.sourceRoot.match(/\/blob\/([^/]+)\//);

        if (match) {
            return match[1];
        }
    }

    return 'master';
}

function normalizeRepoPath(value) {
    return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^(\.\/)+/, '');
}

function isExternalResource(value) {
    return !value || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
}

function isDirectoryLink(value) {
    const pathPart = value.split(/[?#]/)[0];

    if (!pathPart) {
        return false;
    }

    return /\/$/.test(pathPart) || fs.existsSync(path.resolve(process.cwd(), pathPart)) &&
        fs.statSync(path.resolve(process.cwd(), pathPart)).isDirectory();
}

function getGitHubRepoParts(repoUrl) {
    if (!repoUrl) {
        return null;
    }

    const match = repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?$/i);

    if (!match) {
        return null;
    }

    return {
        owner: match[1],
        repo: match[2]
    };
}

function resolveReadmeLink(value, opts) {
    if (isExternalResource(value)) {
        return value;
    }

    const pathPart = normalizeRepoPath(value);
    const customBase = opts.readmeLinkBase;

    if (customBase) {
        return customBase.replace(/\/+$/, '') + '/' + pathPart;
    }

    if (!opts.repo) {
        return value;
    }

    const branch = getReadmeBranch(opts);
    const route = isDirectoryLink(pathPart) ? 'tree' : 'blob';

    return opts.repo.replace(/\/+$/, '') + '/' + route + '/' + branch + '/' + pathPart;
}

function resolveReadmeImage(value, opts) {
    if (isExternalResource(value)) {
        return value;
    }

    const pathPart = normalizeRepoPath(value);
    const customBase = opts.readmeImageBase;

    if (customBase) {
        return customBase.replace(/\/+$/, '') + '/' + pathPart;
    }

    const repo = getGitHubRepoParts(opts.repo);

    if (!repo) {
        return resolveReadmeLink(value, opts);
    }

    return 'https://raw.githubusercontent.com/' + repo.owner + '/' + repo.repo + '/' +
        getReadmeBranch(opts) + '/' + pathPart;
}

function rewriteAttribute(tag, attr, resolver, opts) {
    const pattern = new RegExp('(\\s' + attr + '\\s*=\\s*)(["\\\'])([^"\\\']*)(\\2)', 'i');

    return tag.replace(pattern, function(match, prefix, quote, value, suffix) {
        return prefix + quote + resolver(value, opts) + suffix;
    });
}

function rewriteReadmeLinks(readme, opts) {
    if (!readme) {
        return readme;
    }

    return readme.replace(/<(a|img)\b[^>]*>/gi, function(tag, tagName) {
        if (tagName.toLowerCase() === 'a') {
            return rewriteAttribute(tag, 'href', resolveReadmeLink, opts);
        }

        return rewriteAttribute(tag, 'src', resolveReadmeImage, opts);
    });
}
    
function generate(title, docs, filename, resolveLinks) {
    resolveLinks = resolveLinks === false ? false : true;

    const docData = {
        filename: filename,
        title: title,
        docs: docs
    };
    
    const outpath = path.join(outdir, filename);
    let html = view.render('container.tmpl', docData);
    
    if (resolveLinks) {
        html = helper.resolveLinks(html); // turn {@link foo} into <a href="foodoc.html">foo</a>
        
        // Add a link target for external links.
        html = html.toString().replace(/<a\s+([^>]*href\s*=\s*['"]*[^\s'"]*:\/\/)/ig, '<a target="_blank" $1');
    }

    fs.writeFileSync(outpath, html, 'utf8');
}

function generateSourceFiles(sourceFiles) {
    Object.keys(sourceFiles).forEach(function(file) {
        let source;
        // links are keyed to the shortened path in each doclet's `meta.filename` property
        const sourceOutfile = helper.getUniqueFilename(sourceFiles[file].shortened);
        helper.registerLink(sourceFiles[file].shortened, sourceOutfile);

        try {
            source = {
                kind: 'source',
                code: helper.htmlsafe( fs.readFileSync(sourceFiles[file].resolved, 'utf8') )
            };
        }
        catch(e) {
            handle(e);
        }

        generate('Source: ' + sourceFiles[file].shortened, [source], sourceOutfile,
            false);
    });
}

/**
 * Look for classes or functions with the same name as modules (which indicates that the module
 * exports only that class or function), then attach the classes or functions to the `module`
 * property of the appropriate module doclets. The name of each class or function is also updated
 * for display purposes. This function mutates the original arrays.
 * 
 * @private
 * @param {Array.<module:jsdoc/doclet.Doclet>} doclets - The array of classes and functions to
 * check.
 * @param {Array.<module:jsdoc/doclet.Doclet>} modules - The array of module doclets to search.
 */
function attachModuleSymbols(doclets, modules) {
    const symbols = {};

    // build a lookup table
    doclets.forEach(function(symbol) {
        symbols[symbol.longname] = symbol;
    });

    modules.forEach(function(module) {
        if (symbols[module.longname]) {
            module.module = symbols[module.longname];
            module.module.name = module.module.name.replace('module:', 'require("') + '")';
        }
    });
}

function buildNavItem(type, item) {
    return {
        type: type,
        longname: item.longname,
        name: item.name,
        members: find({
            kind: 'member',
            memberof: item.longname
        }),
        methods: find({
            kind: 'function',
            memberof: item.longname
        }),
        typedefs: find({
            kind: 'typedef',
            memberof: item.longname
        }),
        events: find({
            kind: 'event',
            memberof: item.longname
        })
    };
}

/**
 * Create the navigation sidebar.
 * @param {object} members The members that will be used to create the sidebar.
 * @param {array<object>} members.classes
 * @param {array<object>} members.externals
 * @param {array<object>} members.globals
 * @param {array<object>} members.mixins
 * @param {array<object>} members.modules
 * @param {array<object>} members.namespaces
 * @param {array<object>} members.tutorials
 * @param {array<object>} members.events
 * @return {string} The HTML for the navigation sidebar.
 */
function buildNav(members) {
    const nav = [];
    const sections = [
        { type: 'namespace', items: members.namespaces },
        { type: 'class', items: members.classes }
    ];

    sections.forEach(function(section) {
        section.items.forEach(function(item) {
            nav.push(buildNavItem(section.type, item));
        });
    });

    return nav;
}

function groupByLongname(items) {
    const groups = Object.create(null);

    items.forEach(function(item) {
        if (!groups[item.longname]) {
            groups[item.longname] = [];
        }

        groups[item.longname].push(item);
    });

    return groups;
}

function generateDocletPages(members) {
    const outputSections = [
        { title: 'Class', items: members.classes },
        { title: 'Interface', items: members.interfaces },
        { title: 'Module', items: members.modules },
        { title: 'Namespace', items: members.namespaces },
        { title: 'Mixin', items: members.mixins },
        { title: 'External', items: members.externals }
    ];

    outputSections.forEach(function(section) {
        const groups = groupByLongname(section.items);

        Object.keys(groups).forEach(function(longname) {
            const docs = groups[longname];
            const url = helper.longnameToUrl[longname];

            if (url) {
                generate(section.title + ': ' + docs[0].name, docs, url);
            }
        });
    });
}


/**
    @param {function} docletStore JSDoc's doclet data store.
    @param {object} opts
    @param {Tutorial} tutorials
 */
exports.publish = function(docletStore, opts, tutorials) {
    data = docletStore;

    const conf = env.conf.templates || {};
    conf.default = conf.default || {};

    const templatePath = opts.template;
    view = new template.Template(templatePath + '/tmpl');
    
    // Reserve filenames before JSDoc's uniqueness helper assigns generated names.
    const indexUrl = helper.getUniqueFilename('index');
    // don't call registerLink() on this one! 'index' is also a valid longname

    const globalUrl = helper.getUniqueFilename('global');
    helper.registerLink('global', globalUrl);

    // set up templating
    view.layout = 'layout.tmpl';

    // set up tutorials for helper
    helper.setTutorials(tutorials);

    data = helper.prune(data);
    data.sort('longname, version, since');
    helper.addEventListeners(data);

    // override links to source files to reference sourceRoot
    function linkto(...args) {
        if (opts.sourceRoot && /\.js$/.test(args[0])) {
            if (!args[1])
                args[1] = args[0];
            args[0] = opts.sourceRoot + args[0];
        }
        return helper.linkto.apply(helper, args);
    }

    let sourceFiles = {};
    const sourceFilePaths = [];
    data().each(function(doclet) {
         doclet.attribs = '';
        
        if (doclet.examples) {
            doclet.examples = doclet.examples.map(function(example) {
                let caption;
                let code;
                const match = example.match(/^\s*(?:<p>)?\s*<caption>([\s\S]+?)<\/caption>\s*(?:<\/p>)?[\s\r\n]*([\s\S]+)$/i);

                if (match) {
                    caption = match[1];
                    code = match[2];
                }

                return {
                    caption: caption || '',
                    code: code || example
                };
            });
        }
        if (doclet.see) {
            doclet.see.forEach(function(seeItem, i) {
                doclet.see[i] = hashToLink(doclet, seeItem);
            });
        }

        // build a list of source files
        if (doclet.meta) {
            const sourcePath = getPathFromDoclet(doclet);
            const resolvedSourcePath = resolveSourcePath(sourcePath);
            sourceFiles[sourcePath] = {
                resolved: resolvedSourcePath,
                shortened: null
            };
            sourceFilePaths.push(resolvedSourcePath);
        }
    });
    
    // update outdir if necessary, then create outdir
    const packageInfo = ( find({kind: 'package'}) || [] ) [0];
    if (packageInfo && packageInfo.name) {
        outdir = path.join(outdir, packageInfo.name, packageInfo.version);
    }
    fs.mkPath(outdir);

    // copy the template's static files to outdir
    const fromDir = path.join(templatePath, 'static');
    const staticFiles = fs.ls(fromDir, 3);

    staticFiles.forEach(function(fileName) {
        const toDir = fs.toDir( fileName.replace(fromDir, outdir) );
        fs.mkPath(toDir);
        fs.copyFileSync(fileName, toDir);
    });

    // copy user-specified static files to outdir
    if (conf.default.staticFiles) {
        const staticFilePaths = conf.default.staticFiles.paths || [];
        const staticFileFilter = new (require('jsdoc/src/filter')).Filter(conf.default.staticFiles);
        const staticFileScanner = new (require('jsdoc/src/scanner')).Scanner();

        staticFilePaths.forEach(function(filePath) {
            const extraStaticFiles = staticFileScanner.scan([filePath], 10, staticFileFilter);

            extraStaticFiles.forEach(function(fileName) {
                const sourcePath = fs.statSync(filePath).isDirectory() ? filePath :
                    path.dirname(filePath);
                const toDir = fs.toDir( fileName.replace(sourcePath, outdir) );
                fs.mkPath(toDir);
                fs.copyFileSync(fileName, toDir);
            });
        });
    }
    
    if (sourceFilePaths.length) {
        sourceFiles = shortenPaths( sourceFiles, path.commonPrefix(sourceFilePaths) );
    }
    data().each(function(doclet) {
        const url = helper.createLink(doclet);
        helper.registerLink(doclet.longname, url);

        // replace the filename with a shortened version of the full path
        if (doclet.meta) {
            let docletPath = getPathFromDoclet(doclet);
            docletPath = sourceFiles[docletPath].shortened;
            if (docletPath) {
                doclet.meta.filename = docletPath;
            }
        }
    });
    
    data().each(function(doclet) {
        const url = helper.longnameToUrl[doclet.longname];

        if (url.indexOf('#') > -1) {
            doclet.id = helper.longnameToUrl[doclet.longname].split(/#/).pop();
        }
        else {
            doclet.id = doclet.name;
        }
        
        if ( needsSignature(doclet) ) {
            addSignatureParams(doclet);
            addSignatureReturns(doclet);
            addAttribs(doclet);
        }
    });
    
    // do this after the urls have all been generated
    data().each(function(doclet) {
        doclet.ancestors = getAncestorLinks(doclet);

        if (doclet.kind === 'member') {
            addSignatureTypes(doclet);
            addAttribs(doclet);
        }
        
        if (doclet.kind === 'constant') {
            addSignatureTypes(doclet);
            addAttribs(doclet);
            doclet.kind = 'member';
        }
    });
    
    const members = filterMemberGroups(helper.getMembers(data));
    members.tutorials = tutorials.children;

    // add template helpers
    view.find = find;
    view.linkto = linkto;
    view.resolveAuthorLinks = resolveAuthorLinks;
    view.tutoriallink = tutoriallink;
    view.htmlsafe = htmlsafe;
    view.mangleType = mangleType;
    view.members = members;

    // once for all
    view.nav = buildNav(members);
    attachModuleSymbols( find({ kind: ['class', 'function'], longname: {left: 'module:'} }),
        members.modules );

    // only output pretty-printed source files if requested; do this before generating any other
    // pages, so the other pages can link to the source files
    if (conf['default'].outputSourceFiles) {
        generateSourceFiles(sourceFiles);
    }

    if (members.globals.length) { generate('Global', [{kind: 'globalobj'}], globalUrl); }
    
    // index page displays information from package.json and lists files
    const files = find({kind: 'file'});
    const packages = find({kind: 'package'});

    generate('Index',
        packages.concat(
            [{
                kind: 'mainpage',
                readme: rewriteReadmeLinks(opts.readme, opts),
                longname: (opts.mainpagetitle) ? opts.mainpagetitle : 'Main Page',
                repo: opts.repo
            }]
        ).concat(files),
    indexUrl);

    generateDocletPages(members);

    function generateTutorial(title, tutorial, filename) {
        const tutorialData = {
            title: title,
            header: tutorial.title,
            content: tutorial.parse(),
            children: tutorial.children
        };
        
        const tutorialPath = path.join(outdir, filename);
        let html = view.render('tutorial.tmpl', tutorialData);
        
        // yes, you can use {@link} in tutorials too!
        html = helper.resolveLinks(html); // turn {@link foo} into <a href="foodoc.html">foo</a>
        
        fs.writeFileSync(tutorialPath, html, 'utf8');
    }
    
    // tutorials can have only one parent so there is no risk for loops
    function saveChildren(node) {
        node.children.forEach(function(child) {
            generateTutorial('Tutorial: ' + child.title, child, helper.tutorialToUrl(child.name));
            saveChildren(child);
        });
    }
    saveChildren(tutorials);
};
