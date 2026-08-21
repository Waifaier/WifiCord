(function(){'use strict';
const $=id=>document.getElementById(id);
let canvas,ctx,tool='brush',brush='classic',drawing=false,start=null,last=null,history=[],future=[],layers=[],active=0,grid=false,zoom=1,selection=null,clipboard=null,frames=[],frameIndex=0;
const brushes={classic:{name:'Clássico',cap:'round',join:'round',opacity:1,spacing:1},pencil:{name:'Lápis',cap:'round',join:'round',opacity:.72,spacing:1},ink:{name:'Tinta',cap:'round',join:'round',opacity:1,spacing:.55},watercolor:{name:'Aquarela',cap:'round',join:'round',opacity:.22,spacing:.75},marker:{name:'Marcador',cap:'round',join:'round',opacity:.72,spacing:1.1},chalk:{name:'Giz',cap:'round',join:'round',opacity:.32,spacing:.65},airbrush:{name:'Aerógrafo',cap:'round',join:'round',opacity:.12,spacing:.35},neon:{name:'Neon',cap:'round',join:'round',opacity:.9,spacing:1},pixel:{name:'Pixel',cap:'butt',join:'miter',opacity:1,spacing:1}};

function toast(m,t){window.App?.toast?.(m,t);}

function makeLayer(name){
    const c=document.createElement('canvas');
    c.width=canvas.width;
    c.height=canvas.height;
    return{name,c,visible:true,opacity:1};
}

function initCanvas(){
    canvas=$('wipaint-canvas');
    if(!canvas)return;
    ctx=canvas.getContext('2d',{willReadFrequently:true});
    layers=[makeLayer('Camada 1')];
    active=0;
    frames=[snapshot()];
    frameIndex=0;
    renderLayers();
    resizeCanvas();
    history=[];
    saveHistory();
    updateFrameUI();
}

function resizeCanvas(){
    canvas.style.transform=`scale(${zoom})`;
    canvas.style.transformOrigin='top left';
    render();
}

function render(){
    if(!ctx)return;

    ctx.clearRect(0,0,canvas.width,canvas.height);

    ctx.fillStyle='#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    for(const l of layers){
        if(!l.visible)continue;

        ctx.save();
        ctx.globalAlpha=l.opacity;
        ctx.drawImage(l.c,0,0);
        ctx.restore();
    }

    if(grid){
        ctx.save();
        ctx.globalAlpha=.15;
        ctx.strokeStyle='#64748b';
        ctx.lineWidth=1;

        for(let x=0;x<canvas.width;x+=16){
            ctx.beginPath();
            ctx.moveTo(x,0);
            ctx.lineTo(x,canvas.height);
            ctx.stroke();
        }

        for(let y=0;y<canvas.height;y+=16){
            ctx.beginPath();
            ctx.moveTo(0,y);
            ctx.lineTo(canvas.width,y);
            ctx.stroke();
        }

        ctx.restore();
    }

    if(selection){
        ctx.save();
        ctx.setLineDash([6,4]);
        ctx.strokeStyle='#7c5cff';
        ctx.lineWidth=2;
        ctx.strokeRect(selection.x,selection.y,selection.w,selection.h);
        ctx.restore();
    }
}

function pos(e){
    const r=canvas.getBoundingClientRect();

    return{
        x:Math.max(0,Math.min(canvas.width,(e.clientX-r.left)/zoom)),
        y:Math.max(0,Math.min(canvas.height,(e.clientY-r.top)/zoom))
    };
}

function style(c){
    const b=brushes[brush]||brushes.classic;
    const color=$('wipaint-color')?.value||'#7c5cff';
    const size=Number($('wipaint-size')?.value||12);
    const opacity=Number($('wipaint-opacity')?.value||100)/100;

    c.globalAlpha=opacity*b.opacity;
    c.lineCap=b.cap;
    c.lineJoin=b.join;
    c.lineWidth=brush==='pixel'
        ?Math.max(1,Math.round(size/4))*4
        :size;

    c.strokeStyle=color;
    c.fillStyle=color;

    if(brush==='neon'){
        c.shadowColor=color;
        c.shadowBlur=Math.max(8,size);
    }
}

function snapshot(){
    return layers.map(l=>({
        name:l.name,
        visible:l.visible,
        opacity:l.opacity,
        data:l.c.toDataURL('image/png')
    }));
}

function restore(snap){
    return Promise.all(
        snap.map(x=>new Promise(res=>{
            const l=makeLayer(x.name);

            l.visible=x.visible;
            l.opacity=x.opacity;

            const im=new Image();

            im.onload=()=>{
                l.c.getContext('2d').drawImage(im,0,0);
                res(l);
            };

            im.src=x.data;
        }))
    ).then(ls=>{
        layers=ls;
        active=Math.min(active,layers.length-1);
        renderLayers();
        render();
    });
}

function saveHistory(){
    history.push(snapshot());

    if(history.length>40)
        history.shift();

    future=[];

    frames[frameIndex]=snapshot();

    updateFrameUI();
}

async function undo(){
    if(history.length<2)return;

    future.push(history.pop());

    await restore(history[history.length-1]);

    updateFrameUI();
}

async function redo(){
    const s=future.pop();

    if(!s)return;

    history.push(s);

    await restore(s);

    updateFrameUI();
}

function current(){
    return layers[active];
}

function commit(){
    saveHistory();
}

function pointerDown(e){
    if(e.button!==0)return;

    drawing=true;
    start=pos(e);
    last=start;

    if(tool==='select'){
        selection={
            x:start.x,
            y:start.y,
            w:0,
            h:0
        };

        render();
        return;
    }

    if(tool==='eyedropper'){
        const p=ctx.getImageData(
            Math.floor(start.x),
            Math.floor(start.y),
            1,
            1
        ).data;

        $('wipaint-color').value='#'+
            [p[0],p[1],p[2]]
            .map(x=>x.toString(16).padStart(2,'0'))
            .join('');

        drawing=false;
        return;
    }

    if(tool==='fill'){
        const l=current();
        const c=l.c.getContext('2d');

        c.globalAlpha=
            Number($('wipaint-opacity').value)/100;

        c.fillStyle=$('wipaint-color').value;
        c.fillRect(0,0,l.c.width,l.c.height);

        render();
        commit();

        drawing=false;
        return;
    }

    if(tool==='text'){
        const text=prompt('Texto:');

        if(text){
            const l=current();
            const c=l.c.getContext('2d');

            style(c);

            c.font=
                `600 ${Math.max(
                    12,
                    Number($('wipaint-size').value)*2
                )}px Inter, sans-serif`;

            c.fillText(
                text,
                start.x,
                start.y
            );

            c.shadowBlur=0;

            render();
            commit();
        }

        drawing=false;
        return;
    }

    if(['brush','eraser'].includes(tool))
        drawTo(start,start);
}

function drawTo(a,b){
    const l=current();
    const c=l.c.getContext('2d');

    style(c);

    if(tool==='eraser')
        c.globalCompositeOperation='destination-out';
    else
        c.globalCompositeOperation='source-over';

    if(brush==='pixel'){
        const s=Math.max(
            4,
            Math.round(
                Number($('wipaint-size').value)/4
            )*4
        );

        c.fillRect(
            Math.floor(b.x/s)*s,
            Math.floor(b.y/s)*s,
            s,
            s
        );

    }else if(
        brush==='airbrush'||
        brush==='watercolor'||
        brush==='chalk'
    ){
        const d=Math.max(
            1,
            Math.hypot(
                b.x-a.x,
                b.y-a.y
            )
        );

        const step=Math.max(
            1,
            Number($('wipaint-size').value)*.35
        );

        for(let i=0;i<d;i+=step){
            const t=i/d||0;

            const x=
                a.x+(b.x-a.x)*t;

            const y=
                a.y+(b.y-a.y)*t;

            c.beginPath();

            c.arc(
                x,
                y,
                Math.max(
                    1,
                    Number($('wipaint-size').value)/2
                ),
                0,
                Math.PI*2
            );

            c.fill();
        }

    }else{
        c.beginPath();

        c.moveTo(a.x,a.y);
        c.lineTo(b.x,b.y);

        c.stroke();
    }

    c.shadowBlur=0;
    c.globalCompositeOperation='source-over';

    render();
}

function pointerMove(e){
    if(!drawing)return;

    const p=pos(e);

    if(tool==='select'){
        selection={
            x:Math.min(start.x,p.x),
            y:Math.min(start.y,p.y),
            w:Math.abs(p.x-start.x),
            h:Math.abs(p.y-start.y)
        };

        render();
        return;
    }

    if(['brush','eraser'].includes(tool))
        drawTo(last,p);

    last=p;
}

function pointerUp(e){
    if(!drawing)return;

    const end=pos(e);

    if(['line','rect','circle'].includes(tool)){
        restore(history[history.length-1]).then(()=>{
            const l=current();
            const c=l.c.getContext('2d');

            style(c);

            const x=start.x;
            const y=start.y;
            const w=end.x-x;
            const h=end.y-y;

            c.beginPath();

            if(tool==='line'){
                c.moveTo(x,y);
                c.lineTo(end.x,end.y);
                c.stroke();

            }else if(tool==='rect'){
                c.strokeRect(
                    x,
                    y,
                    w,
                    h
                );

            }else{
                c.ellipse(
                    x+w/2,
                    y+h/2,
                    Math.abs(w/2),
                    Math.abs(h/2),
                    0,
                    0,
                    Math.PI*2
                );

                c.stroke();
            }

            c.shadowBlur=0;

            render();
            commit();
        });

    }else if(tool==='select'){
        render();

    }else{
        commit();
    }

    drawing=false;
    start=last=null;
}

function normalizeSel(){
    if(
        !selection||
        selection.w<2||
        selection.h<2
    )return null;

    return{
        x:Math.round(selection.x),
        y:Math.round(selection.y),
        w:Math.round(selection.w),
        h:Math.round(selection.h)
    };
}

async function copySelection(cut=false){
    const s=normalizeSel();

    if(!s){
        toast(
            'Faça uma seleção primeiro.',
            'error'
        );

        return;
    }

    const tmp=document.createElement('canvas');

    tmp.width=s.w;
    tmp.height=s.h;

    tmp.getContext('2d').drawImage(
        current().c,
        s.x,
        s.y,
        s.w,
        s.h,
        0,
        0,
        s.w,
        s.h
    );

    clipboard={
        canvas:tmp,
        x:s.x,
        y:s.y
    };

    try{
        const blob=await new Promise(
            r=>tmp.toBlob(r,'image/png')
        );

        if(
            navigator.clipboard&&
            window.ClipboardItem
        ){
            await navigator.clipboard.write([
                new ClipboardItem({
                    'image/png':blob
                })
            ]);
        }

    }catch{}

    if(cut){
        current().c
            .getContext('2d')
            .clearRect(
                s.x,
                s.y,
                s.w,
                s.h
            );

        render();
        commit();
    }
}

function paste(){
    if(!clipboard){
        toast(
            'Nada copiado ainda.',
            'error'
        );

        return;
    }

    const l=current();
    const c=l.c.getContext('2d');

    c.drawImage(
        clipboard.canvas,
        selection?.x||
        clipboard.x,
        selection?.y||
        clipboard.y
    );

    render();
    commit();
}

function deleteSelection(){
    const s=normalizeSel();

    if(!s)return;

    current().c
        .getContext('2d')
        .clearRect(
            s.x,
            s.y,
            s.w,
            s.h
        );

    selection=null;

    render();
    commit();
}

function applyEffect(type){
    const l=current();
    const c=l.c.getContext('2d');

    const img=c.getImageData(
        0,
        0,
        l.c.width,
        l.c.height
    );

    const d=img.data;

    for(let i=0;i<d.length;i+=4){
        let r=d[i];
        let g=d[i+1];
        let b=d[i+2];

        if(type==='grayscale'){
            const v=.299*r+.587*g+.114*b;
            r=g=b=v;

        }else if(type==='sepia'){
            [r,g,b]=[
                .393*r+.769*g+.189*b,
                .349*r+.686*g+.168*b,
                .272*r+.534*g+.131*b
            ];

        }else if(type==='invert'){
            r=255-r;
            g=255-g;
            b=255-b;

        }else if(type==='warm'){
            r=Math.min(255,r+22);
            b=Math.max(0,b-14);

        }else if(type==='cool'){
            b=Math.min(255,b+22);
            r=Math.max(0,r-14);
        }

        d[i]=r;
        d[i+1]=g;
        d[i+2]=b;
    }

    c.putImageData(img,0,0);

    render();
    commit();

    toast(
        'Efeito aplicado.',
        'success'
    );
}

function addLayer(){
    layers.push(
        makeLayer(
            'Camada '+(layers.length+1)
        )
    );

    active=layers.length-1;

    renderLayers();
    render();

    commit();
}

function deleteLayer(){
    if(layers.length<=1){
        toast(
            'Mantenha pelo menos uma camada.',
            'error'
        );

        return;
    }

    layers.splice(active,1);

    active=Math.max(
        0,
        active-1
    );

    renderLayers();
    render();

    commit();
}

function duplicateLayer(){
    const src=current();

    const l=makeLayer(
        src.name+' cópia'
    );

    l.c
        .getContext('2d')
        .drawImage(
            src.c,
            0,
            0
        );

    layers.splice(
        active+1,
        0,
        l
    );

    active++;

    renderLayers();
    render();

    commit();
}

function clear(){
    current().c
        .getContext('2d')
        .clearRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

    render();
    commit();
}

function loadImage(file){
    if(!file)return;

    const im=new Image();

    im.onload=()=>{
        canvas.width=
            Math.min(
                1400,
                im.width
            );

        canvas.height=
            Math.min(
                1000,
                im.height
            );

        layers=[
            makeLayer('Imagem')
        ];

        layers[0].c
            .getContext('2d')
            .drawImage(
                im,
                0,
                0,
                canvas.width,
                canvas.height
            );

        active=0;
        history=[];
        future=[];
        frames=[snapshot()];
        frameIndex=0;

        renderLayers();
        render();

        saveHistory();

        URL.revokeObjectURL(
            im.src
        );
    };

    im.src=URL.createObjectURL(file);
}

function save(){
    exportCanvas('png');
}

function compositeCanvas(){
    const out=document.createElement('canvas');

    out.width=canvas.width;
    out.height=canvas.height;

    const oc=out.getContext('2d');

    oc.fillStyle='#fff';

    oc.fillRect(
        0,
        0,
        out.width,
        out.height
    );

    for(const l of layers){
        if(l.visible){
            oc.globalAlpha=l.opacity;
            oc.drawImage(
                l.c,
                0,
                0
            );
        }
    }

    return out;
}

function exportCanvas(type='png'){
    const out=compositeCanvas();

    const a=document.createElement('a');

    a.download=
        'wipaint-'+
        Date.now()+
        '.png';

    a.href=
        out.toDataURL(
            'image/png'
        );

    a.click();
}

function addFrame(){
    frames[frameIndex]=snapshot();

    frames.push(
        snapshot()
    );

    frameIndex=
        frames.length-1;

    restore(
        frames[frameIndex]
    ).then(()=>{
        history=[];
        future=[];
        saveHistory();
        updateFrameUI();

        toast(
            'Novo frame criado.',
            'success'
        );
    });
}

function prevFrame(){
    if(frameIndex<=0)return;

    frames[frameIndex]=snapshot();

    frameIndex--;

    restore(
        frames[frameIndex]
    ).then(()=>{
        history=[];
        future=[];
        saveHistory();
        updateFrameUI();
    });
}

function nextFrame(){
    if(
        frameIndex>=
        frames.length-1
    )return;

    frames[frameIndex]=snapshot();

    frameIndex++;

    restore(
        frames[frameIndex]
    ).then(()=>{
        history=[];
        future=[];
        saveHistory();
        updateFrameUI();
    });
}

function updateFrameUI(){
    const el=$('wipaint-frame-label');

    if(el)
        el.textContent=
            `Frame ${frameIndex+1} / ${Math.max(
                1,
                frames.length
            )}`;

    const tl=$('wipaint-timeline');

    if(tl){
        tl.innerHTML=
            frames.map(
                (_,i)=>
                    `<button type="button" class="wipaint-frame ${i===frameIndex?'active':''}" data-frame="${i}">🎞️ ${i+1}</button>`
            ).join('');

        tl
            .querySelectorAll('[data-frame]')
            .forEach(b=>{
                b.onclick=()=>{
                    frames[frameIndex]=snapshot();

                    frameIndex=
                        Number(
                            b.dataset.frame
                        );

                    restore(
                        frames[frameIndex]
                    ).then(()=>{
                        history=[];
                        future=[];
                        saveHistory();
                        updateFrameUI();
                    });
                };
            });
    }
}

function renderLayers(){
    const box=$('wipaint-layers');

    if(!box)return;

    box.innerHTML=
        layers.map(
            (l,i)=>
                `<div class="wipaint-layer ${i===active?'active':''}" data-layer="${i}">
                    <button type="button" data-vis="${i}">
                        ${l.visible?'👁️':'🚫'}
                    </button>
                    <span>${l.name}</span>
                </div>`
        ).join('');

    box
        .querySelectorAll('[data-layer]')
        .forEach(el=>{
            el.onclick=()=>{
                active=
                    Number(
                        el.dataset.layer
                    );

                renderLayers();
            };
        });

    box
        .querySelectorAll('[data-vis]')
        .forEach(b=>{
            b.onclick=e=>{
                e.stopPropagation();

                const i=
                    Number(
                        b.dataset.vis
                    );

                layers[i].visible=
                    !layers[i].visible;

                renderLayers();
                render();

                commit();
            };
        });
}

function keyboard(e){
    const mod=
        e.ctrlKey||
        e.metaKey;

    if(
        mod&&
        e.key.toLowerCase()==='z'
    ){
        e.preventDefault();
        undo();
        return;
    }

    if(
        mod&&
        e.key.toLowerCase()==='y'
    ){
        e.preventDefault();
        redo();
        return;
    }

    if(
        mod&&
        e.key.toLowerCase()==='c'
    ){
        e.preventDefault();
        copySelection(false);
        return;
    }

    if(
        mod&&
        e.key.toLowerCase()==='x'
    ){
        e.preventDefault();
        copySelection(true);
        return;
    }

    if(
        mod&&
        e.key.toLowerCase()==='v'
    ){
        e.preventDefault();
        paste();
        return;
    }

    if(
        mod&&
        e.key.toLowerCase()==='s'
    ){
        e.preventDefault();
        save();
        return;
    }

    if(
        e.key==='Delete'&&
        selection
    ){
        e.preventDefault();
        deleteSelection();
        return;
    }

    if(e.key==='Escape'){
        selection=null;
        render();
        return;
    }

    if(e.key.toLowerCase()==='b')
        tool='brush';

    if(e.key.toLowerCase()==='e')
        tool='eraser';

    if(e.key.toLowerCase()==='v')
        tool='select';

    if(e.key.toLowerCase()==='p')
        tool='pixel';

    if(e.key.toLowerCase()==='i')
        tool='eyedropper';

    if(e.key.toLowerCase()==='t')
        tool='text';

    if(e.key.toLowerCase()==='l')
        tool='line';

    if(e.key.toLowerCase()==='r')
        tool='rect';

    if(e.key.toLowerCase()==='o')
        tool='circle';

    syncControls();
}

function syncControls(){
    if($('wipaint-tool'))
        $('wipaint-tool').value=tool;

    if($('wipaint-brush'))
        $('wipaint-brush').value=brush;
}

async function sendToConversation(){
    const out=compositeCanvas();

    const blob=await new Promise(
        r=>out.toBlob(
            r,
            'image/png'
        )
    );

    const file=new File(
        [
            blob
        ],
        `wipaint-${Date.now()}.png`,
        {
            type:'image/png'
        }
    );

    if(window.WCMedia?.sendFile){
        await window.WCMedia.sendFile(file);

        toast(
            'Desenho enviado na conversa.',
            'success'
        );
    }else{
        toast(
            'Abra uma conversa antes de enviar.',
            'error'
        );
    }
}

function bind(){
    const openBtn=
        $('wipaint-open-btn');

    if(!openBtn)return;

    openBtn.onclick=()=>{
        $('modal-overlay')
            ?.classList
            .remove('hidden');

        document
            .querySelectorAll('.modal')
            .forEach(
                m=>m.classList.add('hidden')
            );

        $('modal-wipaint')
            ?.classList
            .remove('hidden');

        if(!canvas)
            initCanvas();
    };

    $('wipaint-tool')
        ?.addEventListener(
            'change',
            e=>tool=e.target.value
        );

    $('wipaint-brush')
        ?.addEventListener(
            'change',
            e=>brush=e.target.value
        );

    $('wipaint-size')
        ?.addEventListener(
            'input',
            e=>{
                $('wipaint-size-value')
                    .textContent=
                    e.target.value+
                    ' px';
            }
        );

    $('wipaint-zoom')
        ?.addEventListener(
            'input',
            e=>{
                zoom=
                    Number(
                        e.target.value
                    )/100;

                resizeCanvas();
            }
        );

    $('wipaint-undo')
        ?.addEventListener(
            'click',
            undo
        );

    $('wipaint-redo')
        ?.addEventListener(
            'click',
            redo
        );

    $('wipaint-grid')
        ?.addEventListener(
            'click',
            ()=>{
                grid=!grid;
                render();
            }
        );

    $('wipaint-clear')
        ?.addEventListener(
            'click',
            clear
        );

    $('wipaint-open-image')
        ?.addEventListener(
            'click',
            ()=>$('wipaint-file-input')?.click()
        );

    $('wipaint-file-input')
        ?.addEventListener(
            'change',
            e=>loadImage(
                e.target.files?.[0]
            )
        );

    $('wipaint-save')
        ?.addEventListener(
            'click',
            save
        );

    $('wipaint-send')
        ?.addEventListener(
            'click',
            sendToConversation
        );

    $('wipaint-copy')
        ?.addEventListener(
            'click',
            ()=>copySelection(false)
        );

    $('wipaint-cut')
        ?.addEventListener(
            'click',
            ()=>copySelection(true)
        );

    $('wipaint-paste')
        ?.addEventListener(
            'click',
            paste
        );

    $('wipaint-delete-selection')
        ?.addEventListener(
            'click',
            deleteSelection
        );

    $('wipaint-add-layer')
        ?.addEventListener(
            'click',
            addLayer
        );

    $('wipaint-delete-layer')
        ?.addEventListener(
            'click',
            deleteLayer
        );

    $('wipaint-duplicate-layer')
        ?.addEventListener(
            'click',
            duplicateLayer
        );

    $('wipaint-add-frame')
        ?.addEventListener(
            'click',
            addFrame
        );

    $('wipaint-prev-frame')
        ?.addEventListener(
            'click',
            prevFrame
        );

    $('wipaint-next-frame')
        ?.addEventListener(
            'click',
            nextFrame
        );

    document
        .querySelectorAll(
            '[data-wipaint-effect]'
        )
        .forEach(
            b=>b.addEventListener(
                'click',
                ()=>applyEffect(
                    b.dataset.wipaintEffect
                )
            )
        );

    canvas?.addEventListener(
        'pointerdown',
        pointerDown
    );

    canvas?.addEventListener(
        'pointermove',
        pointerMove
    );

    window.addEventListener(
        'pointerup',
        pointerUp
    );

    window.addEventListener(
        'keydown',
        keyboard
    );
}

document.addEventListener(
    'DOMContentLoaded',
    bind
);

window.WiPaint={
    open:()=>openFile()
};

function openFile(){
    $('wipaint-file-input')?.click();
}

})();
